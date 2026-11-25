import { PlatformCountyDetail, PlatformDataOverview } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound, unauthorized } from '../errors.js';
import type { Services } from '../services/index.js';

/** Platform admin (BUILD_PLAN 8.13). Super-admins only; everyone else gets a plain 404. */
async function requireSuperAdmin(request: FastifyRequest) {
  if (!request.user) throw unauthorized();
  if (!request.user.isSuperAdmin) throw notFound();
}

export const adminRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (
  app,
  { services },
) => {
  // onRequest runs before validation, so non-admins always get the same 404, never a 400.
  app.addHook('onRequest', requireSuperAdmin);

  app.get(
    '/admin/data/overview',
    { schema: { response: { 200: PlatformDataOverview } } },
    async () => services.platformData.overview(),
  );

  app.get(
    '/admin/data/counties/:countyId/:taxYear',
    {
      schema: {
        params: z.object({
          countyId: z.coerce.number().int().positive(),
          taxYear: z.coerce.number().int().min(2000).max(2100),
        }),
        response: { 200: PlatformCountyDetail },
      },
    },
    async (request) => {
      const detail = await services.platformData.county(
        request.params.countyId,
        request.params.taxYear,
      );
      if (!detail) throw notFound('That county and year have no loaded appraisal roll.');
      return detail;
    },
  );
};
