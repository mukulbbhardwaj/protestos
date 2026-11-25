import { REQUEST_ID_HEADER, resolveRequestId } from '@app/shared/node';
import * as Sentry from '@sentry/node';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  /** Returns true when the database answers. Injected so tests can simulate an outage. */
  pingDatabase: () => Promise<boolean>;
  version: string;
  sentry?: boolean;
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(deps: AppDeps, opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: (req) => resolveRequestId(req.headers[REQUEST_ID_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  if (deps.sentry) Sentry.setupFastifyErrorHandler(app);

  await app.register(healthRoutes, deps);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
