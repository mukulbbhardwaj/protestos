import { pingDatabase } from '@app/db';
import type { PrismaClient } from '@app/db/raw';
import {
  DevFileMailProvider,
  MockSignatureProvider,
  type MailProvider,
  type SignatureProvider,
  type StorageProvider,
} from '@app/providers';
import type { JobQueue } from './jobs.js';
import { REQUEST_ID_HEADER, resolveRequestId } from '@app/shared/node';
import rateLimit from '@fastify/rate-limit';
import * as Sentry from '@sentry/node';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandling, registerOriginCheck } from './plugins/errors.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { countyRoutes } from './routes/counties.js';
import { devRoutes } from './routes/dev.js';
import { healthRoutes } from './routes/health.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { calendarRoutes } from './routes/calendar.js';
import { signingRoutes } from './routes/signing.js';
import { tenantRoutes } from './routes/tenant/index.js';
import { loadForm50162, type DocumentDeps } from './services/documents.js';
import { webhookRoutes } from './routes/webhooks.js';
import { createServices } from './services/index.js';

/** Development and tests only; production sets MAIL_WEBHOOK_SECRET. */
export const DEV_MAIL_WEBHOOK_SECRET = 'dev-mail-webhook-secret';

export interface AppDeps {
  prisma: PrismaClient;
  mail: MailProvider;
  storage: StorageProvider;
  jobs: JobQueue;
  appUrl: string;
  version: string;
  cookieSecure?: boolean;
  sessionTtlDays?: number;
  authRateLimitPerMin?: number;
  /** E-signature provider (mock until one is chosen). */
  signature?: SignatureProvider;
  /** The official blank Form 50-162; null until installed. */
  form50162?: () => Promise<Uint8Array | null>;
  /** Shared secret for the mail provider's webhook signature. */
  mailWebhookSecret?: string;
  /** Overrides the DB check (tests simulate an outage with it). */
  pingDatabase?: () => Promise<boolean>;
  sentry?: boolean;
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Called for every registered route; the isolation test uses it to find tenant routes. */
  onRoute?: (route: { method: string | string[]; url: string }) => void;
}

export async function buildApp(deps: AppDeps, opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: (req) => resolveRequestId(req.headers[REQUEST_ID_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  if (opts.onRoute) app.addHook('onRoute', opts.onRoute);

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  registerErrorHandling(app);
  if (deps.sentry) Sentry.setupFastifyErrorHandler(app);
  registerOriginCheck(app, deps.appUrl);
  await app.register(rateLimit, { global: false });

  const services = createServices({
    prisma: deps.prisma,
    mail: deps.mail,
    storage: deps.storage,
    jobs: deps.jobs,
    config: { appUrl: deps.appUrl, sessionTtlDays: deps.sessionTtlDays ?? 30 },
  });
  await registerAuth(app, services, { cookieSecure: deps.cookieSecure ?? false });

  await app.register(healthRoutes, {
    pingDatabase: deps.pingDatabase ?? (() => pingDatabase(deps.prisma)),
    version: deps.version,
  });
  await app.register(authRoutes, { services, rateLimitMax: deps.authRateLimitPerMin ?? 10 });
  await app.register(onboardingRoutes, { services });
  await app.register(countyRoutes, { services });
  await app.register(adminRoutes, { services });
  const documents: DocumentDeps = {
    storage: deps.storage,
    signature: deps.signature ?? new MockSignatureProvider(),
    jobs: deps.jobs,
    appUrl: deps.appUrl,
    form50162: deps.form50162 ?? loadForm50162,
  };
  await app.register(tenantRoutes, { services, documents, prefix: '/orgs/:orgSlug' });
  await app.register(signingRoutes, { services, deps: documents });
  await app.register(calendarRoutes, { services });
  await app.register(webhookRoutes, {
    services,
    mailSecret: deps.mailWebhookSecret ?? DEV_MAIL_WEBHOOK_SECRET,
  });
  if (deps.mail instanceof DevFileMailProvider) {
    await app.register(devRoutes, { mailbox: deps.mail, services });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
