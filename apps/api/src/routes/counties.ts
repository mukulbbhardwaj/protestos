import { CountyOption } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

/** Shared reference data (not tenant data): the 254 Texas counties. */
export const countyRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (
  app,
  { services },
) => {
  app.get(
    '/counties',
    {
      preHandler: requireUser,
      schema: { response: { 200: z.object({ counties: z.array(CountyOption) }) } },
    },
    async () => ({ counties: await services.reference.counties() }),
  );
};
