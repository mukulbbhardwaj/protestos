import { FinanceDashboard, FinanceQuery } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { financeDashboard } from '../../services/finance.js';
import { OrgParams } from './params.js';

/** BUILD_PLAN 8.10 finance dashboard: owners and admins only. */
export const financeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/finance/dashboard',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, querystring: FinanceQuery, response: { 200: FinanceDashboard } },
    },
    async (request) => financeDashboard(tenantOf(request).db, request.query),
  );
};
