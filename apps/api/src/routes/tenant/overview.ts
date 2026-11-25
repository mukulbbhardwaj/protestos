import { OrgOverview } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { tenantOf } from '../../plugins/tenant.js';
import { OrgParams } from './params.js';

export const overviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    { schema: { params: OrgParams, response: { 200: OrgOverview } } },
    async (request) => {
      const { db, role } = tenantOf(request);
      const [org, members, pendingInvitations] = await Promise.all([
        db.org.findFirstOrThrow({
          select: {
            id: true,
            name: true,
            slug: true,
            logoKey: true,
            primaryColor: true,
            planStatus: true,
            trialEndsAt: true,
          },
        }),
        db.membership.count({ where: { status: 'ACTIVE' } }),
        db.invitation.count({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      ]);
      return {
        org: { id: org.id, name: org.name, slug: org.slug },
        role,
        plan: { status: org.planStatus, trialEndsAt: org.trialEndsAt?.toISOString() ?? null },
        counts: { members, pendingInvitations },
        checklist: {
          importedData: false, // CSV import arrives in M3
          brandingSet: Boolean(org.logoKey || org.primaryColor),
          teamInvited: members > 1 || pendingInvitations > 0,
          eSignatureConnected: false, // e-signature arrives in M6
        },
      };
    },
  );
};
