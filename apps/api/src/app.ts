import { pingDatabase } from '@app/db';
import type { PrismaClient } from '@app/db/raw';
import { DevFileMailProvider, type MailProvider, type StorageProvider } from '@app/providers';
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
import { tenantRoutes } from './routes/tenant/index.js';
import { createServices } from './services/index.js';

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
  await app.register(tenantRoutes, { services, prefix: '/orgs/:orgSlug' });
  if (deps.mail instanceof DevFileMailProvider) {
    await app.register(devRoutes, { mailbox: deps.mail });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
