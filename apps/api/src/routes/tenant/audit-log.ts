import { AuditEntry } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { OrgParams } from './params.js';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** id of the last row from the previous page */
  before: z.coerce.bigint().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
});

export const auditLogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit-log',
    {
      preValidation: requireRole('ADMIN'),
      schema: {
        params: OrgParams,
        querystring: Query,
        response: {
          200: z.object({ entries: z.array(AuditEntry), nextBefore: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const { limit, before, entityType, entityId } = request.query;
      const rows = await tenantOf(request).db.auditLog.findMany({
        where: {
          ...(before ? { id: { lt: before } } : {}),
          ...(entityType ? { entityType } : {}),
          ...(entityId ? { entityId } : {}),
        },
        include: { actor: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        entries: page.map((r) => ({
          id: r.id.toString(),
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          actor: r.actor?.name ?? null,
          before: r.before,
          after: r.after,
          createdAt: r.createdAt.toISOString(),
        })),
        nextBefore: rows.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
      };
    },
  );
};
