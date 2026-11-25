import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../plugins/tenant.js';
import { OrgParams } from './params.js';

// Placeholder so role gating is real from M1. The figures arrive with invoices (M4) and
// the finance dashboard (M7).
const FinanceSummary = z.object({
  billedYtd: z.string(),
  collectedYtd: z.string(),
  outstanding: z.string(),
  available: z.literal(false),
});

export const financeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/finance/summary',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, response: { 200: FinanceSummary } },
    },
    async () => ({
      billedYtd: '0.00',
      collectedYtd: '0.00',
      outstanding: '0.00',
      available: false as const,
    }),
  );
};
