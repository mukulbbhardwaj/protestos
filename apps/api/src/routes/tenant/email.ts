import {
  DEFAULT_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  EmailTemplateDto,
  EmailTemplateKeyInput,
  RenderedEmail,
  renderTemplate,
  SaveEmailTemplateInput,
  SendInvoicesInput,
  SendInvoicesResult,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../errors.js';
import type { JobQueue } from '../../jobs.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import { sendInvoices } from '../../services/email.js';
import { actorOf, OrgParams } from './params.js';

type Db = ReturnType<typeof tenantOf>['db'];

async function templates(db: Db): Promise<EmailTemplateDto[]> {
  const custom = await db.emailTemplate.findMany({
    include: { updatedBy: { select: { name: true } } },
  });
  return EMAIL_TEMPLATE_KEYS.map((key) => {
    const c = custom.find((t) => t.key === key);
    return {
      key,
      name: DEFAULT_TEMPLATES[key].name,
      subject: c?.subject ?? DEFAULT_TEMPLATES[key].subject,
      body: c?.body ?? DEFAULT_TEMPLATES[key].body,
      isCustom: Boolean(c),
      placeholders: Object.keys(TEMPLATE_PLACEHOLDERS[key]),
      updatedAt: c?.updatedAt.toISOString() ?? null,
      updatedBy: c?.updatedBy?.name ?? null,
    };
  });
}

function checkPlaceholders(input: z.infer<typeof SaveEmailTemplateInput>) {
  const unknown = unknownPlaceholders(input.key, input);
  if (unknown.length) {
    throw badRequest(
      `This email can't use ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use one of the placeholders listed.`,
    );
  }
}

export const emailRoutes: FastifyPluginAsyncZod<{ jobs: JobQueue }> = async (app, { jobs }) => {
  app.get(
    '/email-templates',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, response: { 200: z.array(EmailTemplateDto) } },
    },
    async (request) => templates(tenantOf(request).db),
  );

  app.put(
    '/email-templates',
    {
      preValidation: requireRole('ADMIN'),
      schema: {
        params: OrgParams,
        body: SaveEmailTemplateInput,
        response: { 200: EmailTemplateDto },
      },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const { key, subject, body } = request.body;
      checkPlaceholders(request.body);
      const before = await db.emailTemplate.findFirst({ where: { key } });
      await db.emailTemplate.upsert({
        where: { orgId_key: { orgId, key } },
        create: { orgId, key, subject, body, updatedById: userId },
        update: { subject, body, updatedById: userId },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'emailTemplate.updated',
        entityType: 'EmailTemplate',
        entityId: key,
        before: before ? { subject: before.subject, body: before.body } : DEFAULT_TEMPLATES[key],
        after: { subject, body },
      });
      return (await templates(db)).find((t) => t.key === key)!;
    },
  );

  app.post(
    '/email-templates/reset',
    {
      preValidation: requireRole('ADMIN'),
      schema: {
        params: OrgParams,
        body: EmailTemplateKeyInput,
        response: { 200: EmailTemplateDto },
      },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const { count } = await db.emailTemplate.deleteMany({ where: { key: request.body.key } });
      if (count) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'emailTemplate.reset',
          entityType: 'EmailTemplate',
          entityId: request.body.key,
        });
      }
      return (await templates(db)).find((t) => t.key === request.body.key)!;
    },
  );

  // Renders unsaved text with sample values, for the editor's preview.
  app.post(
    '/email-templates/preview',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgParams, body: SaveEmailTemplateInput, response: { 200: RenderedEmail } },
    },
    async (request) => {
      checkPlaceholders(request.body);
      return renderTemplate(request.body, TEMPLATE_PLACEHOLDERS[request.body.key]);
    },
  );

  app.post(
    '/invoices/send',
    {
      preValidation: requireRole('STAFF'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: OrgParams, body: SendInvoicesInput, response: { 200: SendInvoicesResult } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const result = await sendInvoices(db, orgId, jobs, request.body, userId);
      if (!request.body.dryRun && !result.repeated && result.queued.length) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'invoice.sent',
          entityType: 'Invoice',
          entityId: result.queued.map((q) => q.invoiceId).join(','),
          after: { count: result.queued.length, skipped: result.skipped.length },
        });
      }
      return result;
    },
  );
};
