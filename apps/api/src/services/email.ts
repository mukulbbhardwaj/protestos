import { forOrg, type OrgDb } from '@app/db';
import type { PrismaClient } from '@app/db/raw';
import type { MailEvent } from '@app/providers';
import {
  nextDeliveryStatus,
  type DeliveryDto,
  type DeliveryStatus,
  type SendInvoicesResult,
} from '@app/shared';
import { JOBS, type JobQueue } from '../jobs.js';

// Queueing emails and tracking them (M5). Sending happens in the worker (`mail.deliver`).

type DeliveryRow = {
  id: number;
  templateKey: DeliveryDto['templateKey'];
  toEmail: string;
  subject: string | null;
  status: DeliveryStatus;
  events: unknown;
  error: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  lastEventAt: Date | null;
};

export function toDeliveryDto(d: DeliveryRow): DeliveryDto {
  return {
    id: d.id,
    templateKey: d.templateKey,
    toEmail: d.toEmail,
    subject: d.subject,
    status: d.status,
    events: (Array.isArray(d.events) ? d.events : []) as DeliveryDto['events'],
    error: d.error,
    queuedAt: d.queuedAt.toISOString(),
    sentAt: d.sentAt?.toISOString() ?? null,
    lastEventAt: d.lastEventAt?.toISOString() ?? null,
  };
}

/**
 * Queues one email per invoice to the client's billing email (falling back to their email).
 * The template follows the invoice layout: zero-savings invoices get INVOICE_ZERO_SAVINGS.
 * The same request key never queues twice (BUILD_PLAN M5 "idempotency key").
 */
export async function sendInvoices(
  db: OrgDb,
  orgId: number,
  jobs: JobQueue,
  input: { invoiceIds: number[]; requestKey: string; dryRun: boolean },
  actorUserId: number | null,
): Promise<SendInvoicesResult> {
  const invoices = await db.invoice.findMany({
    where: { id: { in: input.invoiceIds } },
    include: {
      contact: { select: { id: true, displayName: true, email: true, billingEmail: true } },
    },
    orderBy: { id: 'asc' },
  });
  const existing = await db.emailDelivery.findMany({
    where: {
      idempotencyKey: { in: input.invoiceIds.map((id) => `${input.requestKey}:invoice:${id}`) },
    },
    select: { id: true, invoiceId: true },
  });
  const already = new Map(existing.map((e) => [e.invoiceId, e.id]));
  const result: SendInvoicesResult = { queued: [], skipped: [], repeated: existing.length > 0 };
  const found = new Set(invoices.map((i) => i.id));
  for (const id of input.invoiceIds) {
    if (!found.has(id))
      result.skipped.push({ invoiceId: id, number: null, client: '', reason: 'Not found.' });
  }

  for (const inv of invoices) {
    const target = { invoiceId: inv.id, number: inv.number, client: inv.contact.displayName };
    const toEmail = inv.contact.billingEmail ?? inv.contact.email;
    const reason =
      inv.status === 'DRAFT'
        ? 'Still a draft: issue it first.'
        : inv.status === 'VOID'
          ? 'Void.'
          : !inv.pdfKey
            ? 'Imported invoices have no PDF to send.'
            : !toEmail
              ? 'The client has no email address.'
              : null;
    if (reason) {
      result.skipped.push({ ...target, reason });
      continue;
    }
    const templateKey = inv.template === 'ZERO_SAVINGS' ? 'INVOICE_ZERO_SAVINGS' : 'INVOICE';
    let deliveryId = already.get(inv.id) ?? null;
    if (!input.dryRun && deliveryId === null) {
      const idempotencyKey = `${input.requestKey}:invoice:${inv.id}`;
      try {
        deliveryId = (
          await db.emailDelivery.create({
            data: {
              orgId,
              templateKey,
              contactId: inv.contact.id,
              invoiceId: inv.id,
              toEmail: toEmail!,
              attachmentKeys: [inv.pdfKey!],
              idempotencyKey,
              createdById: actorUserId,
            },
            select: { id: true },
          })
        ).id;
        await jobs.send(JOBS.mailDeliver, { orgId, deliveryId });
      } catch (e) {
        // A concurrent duplicate of this request got there first: reuse its delivery.
        if ((e as { code?: string }).code !== 'P2002') throw e;
        result.repeated = true;
        deliveryId = (
          await db.emailDelivery.findFirstOrThrow({
            where: { idempotencyKey },
            select: { id: true },
          })
        ).id;
      }
    }
    result.queued.push({ ...target, toEmail: toEmail!, templateKey, deliveryId });
  }
  return result;
}

/** Queues a payment receipt to the client, if they have an email. Returns the delivery id. */
export async function queueReceipt(
  db: OrgDb,
  orgId: number,
  jobs: JobQueue,
  paymentId: number,
  actorUserId: number | null,
): Promise<number | null> {
  const p = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { contact: { select: { id: true, email: true, billingEmail: true } } },
  });
  const toEmail = p.contact.billingEmail ?? p.contact.email;
  if (!toEmail) return null;
  const d = await db.emailDelivery.upsert({
    where: { orgId_idempotencyKey: { orgId, idempotencyKey: `receipt:payment:${paymentId}` } },
    create: {
      orgId,
      templateKey: 'PAYMENT_RECEIPT',
      contactId: p.contact.id,
      paymentId,
      toEmail,
      idempotencyKey: `receipt:payment:${paymentId}`,
      createdById: actorUserId,
    },
    update: {},
    select: { id: true, status: true },
  });
  if (d.status === 'QUEUED') await jobs.send(JOBS.mailDeliver, { orgId, deliveryId: d.id });
  return d.id;
}

/**
 * Applies provider events. Each event finds its delivery (and so its org) by the provider's
 * message id, never by anything else in the payload; repeated event ids change nothing.
 */
export async function applyMailEvents(prisma: PrismaClient, events: MailEvent[]) {
  let applied = 0;
  for (const e of events) {
    // Platform lookup by the stored provider id; the update itself runs scoped to that org.
    const owner = await prisma.emailDelivery.findUnique({
      where: { providerMessageId: e.providerMessageId },
      select: { id: true, orgId: true },
    });
    if (!owner) continue;
    const db = forOrg(prisma, owner.orgId);
    const d = await db.emailDelivery.findUniqueOrThrow({
      where: { id: owner.id },
      select: { status: true, events: true },
    });
    const seen = (Array.isArray(d.events) ? d.events : []) as { id: string }[];
    if (seen.some((x) => x.id === e.id)) continue;
    await db.emailDelivery.update({
      where: { id: owner.id },
      data: {
        status: nextDeliveryStatus(d.status, e.type),
        events: [
          ...seen,
          { id: e.id, type: e.type, at: e.at, ...(e.detail ? { detail: e.detail } : {}) },
        ],
        lastEventAt: new Date(e.at),
      },
    });
    applied += 1;
  }
  return applied;
}
