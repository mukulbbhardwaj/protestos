import { OrgOverview } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { tenantOf } from '../../plugins/tenant.js';
import { currentTaxYear } from './mappers.js';
import { OrgParams } from './params.js';

export const overviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    { schema: { params: OrgParams, response: { 200: OrgOverview } } },
    async (request) => {
      const { db, role, userId } = tenantOf(request);
      const [org, members, pendingInvitations, clients] = await Promise.all([
        db.org.findFirstOrThrow({
          select: {
            id: true,
            name: true,
            slug: true,
            logoKey: true,
            primaryColor: true,
            planStatus: true,
            trialEndsAt: true,
            taxYearDefault: true,
          },
        }),
        db.membership.count({ where: { status: 'ACTIVE' } }),
        db.invitation.count({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        db.contact.count({ where: { kind: 'CLIENT', archivedAt: null } }),
      ]);
      const taxYear = currentTaxYear(org);
      const activeYear = { taxYear, property: { archivedAt: null } };
      const [propertiesThisYear, newProspects30d, myProperties, stages, bouncedEmails] =
        await Promise.all([
          db.taxYearRecord.count({ where: activeYear }),
          db.contact.count({
            where: { kind: 'PROSPECT', createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          }),
          db.property.count({ where: { consultantUserId: userId, archivedAt: null } }),
          db.taxYearRecord.groupBy({
            by: ['protestStage'],
            where: activeYear,
            _count: { _all: true },
          }),
          db.emailDelivery.count({
            where: { status: 'BOUNCED', queuedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          }),
        ]);
      return {
        org: { id: org.id, name: org.name, slug: org.slug },
        role,
        plan: { status: org.planStatus, trialEndsAt: org.trialEndsAt?.toISOString() ?? null },
        counts: { members, pendingInvitations },
        stats: {
          taxYear,
          activeClients: clients,
          propertiesThisYear,
          newProspects30d,
          myProperties,
          bouncedEmails,
          stages: stages.map((s) => ({ stage: s.protestStage, count: s._count._all })),
        },
        checklist: {
          importedData: clients > 0,
          brandingSet: Boolean(org.logoKey || org.primaryColor),
          teamInvited: members > 1 || pendingInvitations > 0,
          eSignatureConnected: false, // e-signature arrives in M6
        },
      };
    },
  );
};
