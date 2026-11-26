import { OrgOverview, zonedToUtc } from '@app/shared';
import { todayIn } from '../../services/billing.js';
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
            timezone: true,
          },
        }),
        db.membership.count({ where: { status: 'ACTIVE' } }),
        db.invitation.count({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        db.contact.count({ where: { kind: 'CLIENT', archivedAt: null } }),
      ]);
      const sentDocuments = await db.signatureEnvelope.count();
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
      // "Today" and "this week" in the firm's time zone: the next 7 days from midnight.
      const startOfToday = zonedToUtc(todayIn(org.timezone), '00:00', org.timezone);
      const DAY = 86_400_000;
      const live = {
        deletedAt: null,
        status: { in: ['SCHEDULED' as const, 'RESCHEDULED' as const] },
      };
      const [hearingsToday, hearingsThisWeek, documentsAwaitingSignature] = await Promise.all([
        db.hearing.count({
          where: {
            ...live,
            scheduledAt: { gte: startOfToday, lt: new Date(startOfToday.getTime() + DAY) },
          },
        }),
        db.hearing.count({
          where: {
            ...live,
            scheduledAt: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 7 * DAY) },
          },
        }),
        db.document.count({ where: { status: { in: ['SENT', 'VIEWED'] } } }),
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
          hearingsToday,
          hearingsThisWeek,
          documentsAwaitingSignature,
          stages: stages.map((s) => ({ stage: s.protestStage, count: s._count._all })),
        },
        checklist: {
          importedData: clients > 0,
          brandingSet: Boolean(org.logoKey || org.primaryColor),
          teamInvited: members > 1 || pendingInvitations > 0,
          // Mock provider until one is chosen: done once the firm has sent documents.
          eSignatureConnected: sentDocuments > 0,
        },
      };
    },
  );
};
