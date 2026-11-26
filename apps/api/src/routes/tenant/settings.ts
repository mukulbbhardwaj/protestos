import { OrgSettings, UpdateOrgSettingsInput } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { diff, recordAudit } from '../../services/audit.js';
import { actorOf, OrgParams } from './params.js';

type OrgRow = Awaited<ReturnType<ReturnType<typeof tenantOf>['db']['org']['findFirstOrThrow']>>;

function toSettings(org: OrgRow): OrgSettings {
  return {
    name: org.name,
    slug: org.slug,
    state: org.state,
    timezone: org.timezone,
    phone: org.phone,
    website: org.website,
    addressLines: org.addressLines,
    primaryColor: org.primaryColor,
    defaultContingencyPct: org.defaultContingencyPct.toString(),
    defaultFlatFee: org.defaultFlatFee.toFixed(2),
    defaultBppFee: org.defaultBppFee.toFixed(2),
    invoicePrefix: org.invoicePrefix,
    nextInvoiceNumber: org.nextInvoiceNumber,
    invoiceDueDays: org.invoiceDueDays,
    taxYearDefault: org.taxYearDefault,
    savingsBasis: org.savingsBasis,
    flatFeeCurrentYearOnly: org.flatFeeCurrentYearOnly,
    invoiceGrouping: org.invoiceGrouping,
    paymentInstructions: org.paymentInstructions,
    agentName: org.agentName,
    agentTitle: org.agentTitle,
    agentLicense: org.agentLicense,
    allowResendSigned: org.allowResendSigned,
    plan: org.plan,
    planStatus: org.planStatus,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
  };
}

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const admin = requireRole('ADMIN');

  app.get(
    '/settings',
    { preValidation: admin, schema: { params: OrgParams, response: { 200: OrgSettings } } },
    async (request) => toSettings(await tenantOf(request).db.org.findFirstOrThrow()),
  );

  app.patch(
    '/settings',
    {
      preValidation: admin,
      schema: { params: OrgParams, body: UpdateOrgSettingsInput, response: { 200: OrgSettings } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await db.org.findFirstOrThrow();
      const updated = await db.org.update({ where: { id: orgId }, data: request.body });
      const changes = diff(toSettings(before), toSettings(updated));
      if (Object.keys(changes.after).length > 0) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'settings.updated',
          entityType: 'Org',
          entityId: orgId,
          ...changes,
        });
      }
      return toSettings(updated);
    },
  );
};
