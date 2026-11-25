import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  version: z.string(),
});

export interface HealthOptions {
  pingDatabase: () => Promise<boolean>;
  version: string;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (app, deps) => {
  app.get(
    '/health',
    { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
    async (_request, reply) => {
      const dbOk = await deps.pingDatabase();
      return reply.code(dbOk ? 200 : 503).send({
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk ? 'ok' : 'down',
        version: deps.version,
      });
    },
  );
};
