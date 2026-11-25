import { SearchResults } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { tenantOf } from '../../plugins/tenant.js';
import { normalizeAccount } from './mappers.js';
import { OrgParams } from './params.js';

const LIMIT = 8;

/** Cmd/Ctrl+K (BUILD_PLAN 8.12). Trigram-indexed ILIKE, always scoped to the firm. */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      schema: {
        params: OrgParams,
        querystring: z.object({ q: z.string().trim().min(2).max(100) }),
        response: { 200: SearchResults },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query.q;
      const like = { contains: q, mode: 'insensitive' as const };
      const [contacts, properties] = await Promise.all([
        db.contact.findMany({
          where: {
            archivedAt: null,
            OR: [
              { displayName: like },
              { email: like },
              { clientNumber: like },
              { phone: { contains: q } },
            ],
          },
          select: { id: true, kind: true, displayName: true, clientNumber: true, email: true },
          orderBy: { displayName: 'asc' },
          take: LIMIT,
        }),
        db.property.findMany({
          where: {
            archivedAt: null,
            OR: [
              { accountNumber: { contains: normalizeAccount(q), mode: 'insensitive' } },
              { situsLine: like },
            ],
          },
          select: {
            id: true,
            accountNumber: true,
            situsLine: true,
            county: { select: { name: true } },
            contact: { select: { displayName: true } },
          },
          orderBy: { accountNumber: 'asc' },
          take: LIMIT,
        }),
      ]);
      return {
        contacts,
        properties: properties.map((p) => ({
          id: p.id,
          accountNumber: p.accountNumber,
          county: p.county.name,
          situsLine: p.situsLine,
          owner: p.contact.displayName,
        })),
      };
    },
  );
};
