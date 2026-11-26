import type { Prisma } from '@app/db';
import {
  ClientBilling,
  CreatePaymentInput,
  isPastDue,
  OPEN_STATUSES,
  paged,
  PaymentDto,
  PaymentListQuery,
  sumMoney,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import {
  applyCredit,
  clientCredit,
  createPayment,
  deletePayment,
  statementPdf,
  todayIn,
} from '../../services/billing.js';
import type { JobQueue } from '../../jobs.js';
import { queueReceipt } from '../../services/email.js';
import { INVOICE_SUMMARY_INCLUDE, toInvoiceSummary } from './invoices.js';
import { day, money } from './mappers.js';
import { actorOf, Ok, OrgIdParams, OrgParams } from './params.js';

type Db = ReturnType<typeof tenantOf>['db'];

const PAYMENT_INCLUDE = {
  contact: { select: { id: true, displayName: true, clientNumber: true } },
  createdBy: { select: { name: true } },
  allocations: { include: { invoice: { select: { number: true } } }, orderBy: { id: 'asc' } },
  deliveries: { orderBy: { id: 'desc' }, take: 1, select: { status: true, toEmail: true } },
} as const;

function toPayment(p: Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>): PaymentDto {
  const allocated = sumMoney(p.allocations.map((a) => a.amount.toString()));
  return {
    id: p.id,
    contact: p.contact,
    receivedAt: day(p.receivedAt)!,
    amount: money(p.amount)!,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    allocated,
    unallocated: sumMoney([p.amount.toString(), `-${allocated}`]),
    allocations: p.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      number: a.invoice.number,
      amount: money(a.amount)!,
    })),
    createdBy: p.createdBy?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    receipt: p.deliveries[0] ?? null,
  };
}

async function onePayment(db: Db, id: number) {
  const p = await db.payment.findFirst({
    where: { id, deletedAt: null },
    include: PAYMENT_INCLUDE,
  });
  if (!p) throw notFound('That payment was not found.');
  return toPayment(p);
}

export const paymentRoutes: FastifyPluginAsyncZod<{ jobs: JobQueue }> = async (app, { jobs }) => {
  app.get(
    '/payments',
    {
      schema: {
        params: OrgParams,
        querystring: PaymentListQuery,
        response: { 200: paged(PaymentDto).extend({ sum: z.string() }) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const where: Prisma.PaymentWhereInput = {
        deletedAt: null,
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.method ? { method: q.method } : {}),
        ...(q.from || q.to
          ? {
              receivedAt: {
                ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
                ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}),
              },
            }
          : {}),
      };
      const [rows, total, agg] = await Promise.all([
        db.payment.findMany({
          where,
          include: PAYMENT_INCLUDE,
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.payment.count({ where }),
        db.payment.aggregate({ where, _sum: { amount: true } }),
      ]);
      return {
        items: rows.map(toPayment),
        total,
        page: q.page,
        pageSize: q.pageSize,
        sum: money(agg._sum.amount) ?? '0.00',
      };
    },
  );

  app.post(
    '/payments',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgParams, body: CreatePaymentInput, response: { 201: PaymentDto } },
    },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const id = await createPayment(db, orgId, request.body, userId);
      if (request.body.sendReceipt) await queueReceipt(db, orgId, jobs, id, userId);
      const p = await onePayment(db, id);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'payment.recorded',
        entityType: 'Payment',
        entityId: id,
        after: p,
      });
      return reply.code(201).send(p);
    },
  );

  app.get(
    '/payments/:id',
    { schema: { params: OrgIdParams, response: { 200: PaymentDto } } },
    async (request) => onePayment(tenantOf(request).db, request.params.id),
  );

  app.delete(
    '/payments/:id',
    { preValidation: requireRole('STAFF'), schema: { params: OrgIdParams, response: { 200: Ok } } },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const before = await onePayment(db, request.params.id);
      await deletePayment(db, orgId, request.params.id, userId);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'payment.deleted',
        entityType: 'Payment',
        entityId: request.params.id,
        before,
      });
      return { ok: true as const };
    },
  );

  // A client's money position: open invoices, credit, and their statement.
  app.get(
    '/contacts/:id/billing',
    { schema: { params: OrgIdParams, response: { 200: ClientBilling } } },
    async (request) => {
      const { db } = tenantOf(request);
      const c = await db.contact.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          displayName: true,
          clientNumber: true,
          email: true,
          billingEmail: true,
        },
      });
      if (!c) throw notFound('That client was not found.');
      const org = await db.org.findFirstOrThrow({ select: { timezone: true } });
      const today = todayIn(org.timezone);
      const open = await db.invoice.findMany({
        where: { contactId: c.id, status: { in: [...OPEN_STATUSES] } },
        include: INVOICE_SUMMARY_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      });
      const items = open.map((i) => toInvoiceSummary(i, today));
      return {
        contact: { id: c.id, displayName: c.displayName, clientNumber: c.clientNumber },
        hasEmail: Boolean(c.billingEmail ?? c.email),
        credit: await clientCredit(db, c.id),
        openBalance: sumMoney(items.map((i) => i.balance)),
        pastDueBalance: sumMoney(
          items.filter((i) => isPastDue(i.status, i.dueDate, today)).map((i) => i.balance),
        ),
        openInvoices: items,
      };
    },
  );

  app.post(
    '/contacts/:id/apply-credit',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, response: { 200: z.object({ applied: z.string() }) } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const applied = await applyCredit(db, orgId, request.params.id, userId);
      if (applied !== '0.00') {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'payment.creditApplied',
          entityType: 'Contact',
          entityId: request.params.id,
          after: { applied },
        });
      }
      return { applied };
    },
  );

  app.get(
    '/contacts/:id/statement.pdf',
    { schema: { params: OrgIdParams } },
    async (request, reply) => {
      const bytes = await statementPdf(tenantOf(request).db, request.params.id);
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="Statement ${request.params.id}.pdf"`)
        .send(Buffer.from(bytes));
    },
  );
};
