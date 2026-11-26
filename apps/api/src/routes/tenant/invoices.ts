import type { Prisma } from '@app/db';
import type { StorageProvider } from '@app/providers';
import {
  AddInvoiceLineInput,
  GenerateInvoicesInput,
  GeneratePreview,
  Id,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceSummary,
  InvoiceTotals,
  IssueInvoiceInput,
  isPastDue,
  OPEN_STATUSES,
  paged,
  ReasonInput,
  UpdateInvoiceInput,
  type InvoiceTemplate,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import {
  addAdjustment,
  billToOf,
  deleteDraft,
  generateInvoices,
  invoicePdf,
  issueInvoice,
  removeLine,
  todayIn,
  voidInvoice,
  writeOffInvoice,
} from '../../services/billing.js';
import { day, iso, money } from './mappers.js';
import { actorOf, Ok, OrgIdParams, OrgParams } from './params.js';

type Db = ReturnType<typeof tenantOf>['db'];

const SUMMARY_INCLUDE = {
  contact: { select: { id: true, displayName: true, clientNumber: true } },
  lines: { select: { propertyId: true } },
} as const;

type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

function toSummary(i: SummaryRow, today: string): InvoiceSummary {
  return {
    id: i.id,
    number: i.number,
    contact: i.contact,
    taxYear: i.taxYear,
    status: i.status,
    pastDue: isPastDue(i.status, day(i.dueDate), today),
    template: i.template,
    issueDate: day(i.issueDate),
    dueDate: day(i.dueDate),
    total: money(i.total)!,
    amountPaid: money(i.amountPaid)!,
    balance: money(i.balance)!,
    propertyCount: new Set(i.lines.map((l) => l.propertyId).filter(Boolean)).size,
    historical: i.historical,
    sentAt: iso(i.sentAt),
    createdAt: i.createdAt.toISOString(),
  };
}
export { toSummary as toInvoiceSummary, SUMMARY_INCLUDE as INVOICE_SUMMARY_INCLUDE };

async function today(db: Db) {
  const org = await db.org.findFirstOrThrow({ select: { timezone: true } });
  return todayIn(org.timezone);
}

async function detail(db: Db, id: number): Promise<InvoiceDetail> {
  const i = await db.invoice.findUnique({
    where: { id },
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
          clientNumber: true,
          email: true,
          billingEmail: true,
          mailingAddress: true,
        },
      },
      lines: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          property: {
            select: {
              id: true,
              accountNumber: true,
              situsLine: true,
              county: { select: { name: true } },
            },
          },
        },
      },
      allocations: {
        where: { payment: { deletedAt: null } },
        include: { payment: true },
        orderBy: { payment: { receivedAt: 'asc' } },
      },
    },
  });
  if (!i) throw notFound('That invoice was not found.');
  return {
    ...toSummary(
      {
        ...i,
        contact: {
          id: i.contact.id,
          displayName: i.contact.displayName,
          clientNumber: i.contact.clientNumber,
        },
      },
      await today(db),
    ),
    subtotal: money(i.subtotal)!,
    notes: i.notes,
    voidedAt: iso(i.voidedAt),
    voidReason: i.voidReason,
    writtenOffAt: iso(i.writtenOffAt),
    writeOffReason: i.writeOffReason,
    hasPdf: Boolean(i.pdfKey),
    lines: i.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      amount: money(l.amount)!,
      property: l.property
        ? {
            id: l.property.id,
            accountNumber: l.property.accountNumber,
            county: l.property.county.name,
            situsLine: l.property.situsLine,
          }
        : null,
      taxYearRecordId: l.taxYearRecordId,
      snapshot: (l.snapshot ?? null) as Record<string, unknown> | null,
    })),
    payments: i.allocations.map((a) => ({
      paymentId: a.paymentId,
      receivedAt: day(a.payment.receivedAt)!,
      method: a.payment.method,
      reference: a.payment.reference,
      amount: money(a.amount)!,
    })),
    billTo: billToOf(i.contact),
  };
}

/** Invoices list filters → Prisma where. Exported for the client billing view. */
export function invoiceWhere(
  q: z.infer<typeof InvoiceListQuery>,
  todayIso: string,
): Prisma.InvoiceWhereInput {
  const status: Prisma.InvoiceWhereInput =
    q.status === 'OPEN'
      ? { status: { in: [...OPEN_STATUSES] } }
      : q.status === 'PAST_DUE'
        ? {
            status: { in: [...OPEN_STATUSES] },
            dueDate: { lt: new Date(`${todayIso}T00:00:00Z`) },
          }
        : q.status
          ? { status: q.status }
          : {};
  return {
    ...status,
    ...(q.taxYear ? { taxYear: q.taxYear } : {}),
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.q
      ? {
          OR: [
            { number: { contains: q.q, mode: 'insensitive' as const } },
            { contact: { displayName: { contains: q.q, mode: 'insensitive' as const } } },
            { contact: { clientNumber: q.q } },
          ],
        }
      : {}),
  };
}

export const invoiceRoutes: FastifyPluginAsyncZod<{ storage: StorageProvider }> = async (
  app,
  { storage },
) => {
  app.get(
    '/invoices',
    {
      schema: {
        params: OrgParams,
        querystring: InvoiceListQuery,
        response: { 200: paged(InvoiceSummary).extend({ totals: InvoiceTotals }) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const t = await today(db);
      const where = invoiceWhere(q, t);
      const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
        q.sort === 'number'
          ? [{ number: 'desc' }]
          : q.sort === 'due'
            ? [{ dueDate: 'asc' }, { id: 'asc' }]
            : q.sort === 'balance'
              ? [{ balance: 'desc' }, { id: 'desc' }]
              : [{ createdAt: 'desc' }, { id: 'desc' }];
      const [rows, total, sums] = await Promise.all([
        db.invoice.findMany({
          where,
          include: SUMMARY_INCLUDE,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.invoice.count({ where }),
        db.invoice.aggregate({ where, _sum: { total: true, balance: true } }),
      ]);
      return {
        items: rows.map((r) => toSummary(r, t)),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totals: {
          count: total,
          total: money(sums._sum.total) ?? '0.00',
          balance: money(sums._sum.balance) ?? '0.00',
        },
      };
    },
  );

  app.post(
    '/invoices/generate',
    {
      preValidation: requireRole('STAFF'),
      schema: {
        params: OrgParams,
        querystring: z.object({ dryRun: z.enum(['true', 'false']).default('true') }),
        body: GenerateInvoicesInput,
        response: { 200: GeneratePreview.extend({ createdIds: z.array(z.number()) }) },
      },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const create = request.query.dryRun === 'false';
      const result = await generateInvoices(
        db,
        orgId,
        request.body,
        create ? 'create' : 'preview',
        userId,
      );
      if (create && result.createdIds.length) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'invoice.generated',
          entityType: 'Invoice',
          entityId: result.createdIds.join(','),
          after: { taxYear: result.taxYear, count: result.createdIds.length, total: result.total },
        });
      }
      return result;
    },
  );

  app.get(
    '/invoices/:id',
    { schema: { params: OrgIdParams, response: { 200: InvoiceDetail } } },
    async (request) => detail(tenantOf(request).db, request.params.id),
  );

  app.get('/invoices/:id/pdf', { schema: { params: OrgIdParams } }, async (request, reply) => {
    const { db } = tenantOf(request);
    const inv = await db.invoice.findUnique({
      where: { id: request.params.id },
      select: { number: true, pdfKey: true, status: true },
    });
    if (!inv) throw notFound('That invoice was not found.');
    // Issued invoices serve the copy frozen at issue; drafts render live.
    const bytes =
      inv.pdfKey && inv.status !== 'DRAFT'
        ? await storage.get(inv.pdfKey).catch(() => invoicePdf(db, request.params.id))
        : await invoicePdf(db, request.params.id);
    const name = inv.number
      ? `Invoice ${inv.number}.pdf`
      : `Draft invoice ${request.params.id}.pdf`;
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${name}"`)
      .send(Buffer.from(bytes));
  });

  app.patch(
    '/invoices/:id',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: UpdateInvoiceInput, response: { 200: InvoiceDetail } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await db.invoice.findUnique({ where: { id: request.params.id } });
      if (!before) throw notFound('That invoice was not found.');
      // Notes can change at any time; the layout only while a draft.
      const { template, notes } = request.body;
      if (template !== undefined && before.status !== 'DRAFT' && template !== before.template) {
        throw conflict("An issued invoice's layout is fixed. Void it and generate a new one.");
      }
      await db.invoice.update({
        where: { id: before.id },
        data: {
          ...(template ? { template: template as InvoiceTemplate } : {}),
          ...(notes !== undefined ? { notes } : {}),
        },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.updated',
        entityType: 'Invoice',
        entityId: before.id,
        before: { template: before.template, notes: before.notes },
        after: request.body,
      });
      return detail(db, before.id);
    },
  );

  app.post(
    '/invoices/:id/lines',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: AddInvoiceLineInput, response: { 200: InvoiceDetail } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      await addAdjustment(db, orgId, request.params.id, request.body);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.lineAdded',
        entityType: 'Invoice',
        entityId: request.params.id,
        after: request.body,
      });
      return detail(db, request.params.id);
    },
  );

  app.delete(
    '/invoices/:id/lines/:lineId',
    {
      preValidation: requireRole('STAFF'),
      schema: {
        params: OrgIdParams.extend({ lineId: Id }),
        response: { 200: z.object({ deleted: z.boolean() }) },
      },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const r = await removeLine(db, orgId, request.params.id, request.params.lineId);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.lineRemoved',
        entityType: 'Invoice',
        entityId: request.params.id,
        before: { lineId: request.params.lineId },
      });
      return r;
    },
  );

  app.delete(
    '/invoices/:id',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, response: { 200: Ok } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      await deleteDraft(db, request.params.id);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.draftDeleted',
        entityType: 'Invoice',
        entityId: request.params.id,
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/invoices/:id/issue',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: IssueInvoiceInput, response: { 200: InvoiceDetail } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const number = await issueInvoice(
        db,
        orgId,
        storage,
        request.params.id,
        request.body,
        userId,
      );
      const d = await detail(db, request.params.id);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.issued',
        entityType: 'Invoice',
        entityId: request.params.id,
        after: { number, total: d.total, issueDate: d.issueDate, dueDate: d.dueDate },
      });
      return d;
    },
  );

  app.post(
    '/invoices/:id/void',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: ReasonInput, response: { 200: InvoiceDetail } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const released = await voidInvoice(db, orgId, request.params.id, request.body.reason, userId);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.voided',
        entityType: 'Invoice',
        entityId: request.params.id,
        after: { reason: request.body.reason, paymentsReturnedToCredit: released },
      });
      return detail(db, request.params.id);
    },
  );

  app.post(
    '/invoices/:id/write-off',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: ReasonInput, response: { 200: InvoiceDetail } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await detail(db, request.params.id);
      await writeOffInvoice(db, request.params.id, request.body.reason);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invoice.writtenOff',
        entityType: 'Invoice',
        entityId: request.params.id,
        after: { reason: request.body.reason, balance: before.balance },
      });
      return detail(db, request.params.id);
    },
  );
};
