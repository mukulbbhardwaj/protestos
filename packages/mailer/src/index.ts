import type { OrgDb } from '@app/db';
import type { MailAttachment, MailProvider, StorageProvider } from '@app/providers';
import {
  DEFAULT_TEMPLATES,
  OPEN_STATUSES,
  renderTemplate,
  sumMoney,
  type EmailTemplateContent,
  type EmailTemplateKey,
} from '@app/shared';

// Sends one queued EmailDelivery (M5). Runs in the worker (`mail.deliver`) and inline in API
// tests. Safe to run twice: only QUEUED or FAILED deliveries are sent, and the provider gets
// the delivery's idempotency key.

export const MAIL_JOB = 'mail.deliver';

export interface MailerDeps {
  mail: MailProvider;
  storage: StorageProvider;
}

/** The firm's edited copy of a template, or the built-in one. */
export async function templateFor(db: OrgDb, key: EmailTemplateKey): Promise<EmailTemplateContent> {
  const custom = await db.emailTemplate.findFirst({
    where: { key },
    select: { subject: true, body: true },
  });
  return custom ?? DEFAULT_TEMPLATES[key];
}

const usd = (v: { toString(): string } | string) =>
  Number(v.toString()).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const longDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
const METHOD: Record<string, string> = {
  ZELLE: 'Zelle',
  CHECK: 'Check',
  ACH: 'ACH',
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Payment',
};

/** Placeholder values for a delivery (see TEMPLATE_PLACEHOLDERS). */
export async function varsFor(
  db: OrgDb,
  delivery: { contactId: number; invoiceId: number | null; paymentId: number | null },
) {
  const org = await db.org.findFirstOrThrow({
    select: { name: true, phone: true, website: true, paymentInstructions: true },
  });
  const contact = await db.contact.findUniqueOrThrow({
    where: { id: delivery.contactId },
    select: { displayName: true, clientNumber: true },
  });
  const vars: Record<string, string> = {
    'org.name': org.name,
    'org.phone': org.phone ?? '',
    'org.website': org.website ?? '',
    // Never leave "How to pay:" empty when the firm hasn't written instructions yet.
    'org.paymentInstructions':
      org.paymentInstructions ??
      `Reply to this email or call ${org.phone ?? 'us'} for payment options.`,
    'client.displayName': contact.displayName,
    'client.clientNumber': contact.clientNumber ?? '',
  };
  if (delivery.invoiceId) {
    const inv = await db.invoice.findUniqueOrThrow({
      where: { id: delivery.invoiceId },
      include: { lines: { select: { propertyId: true } } },
    });
    Object.assign(vars, {
      'invoice.number': inv.number ?? '',
      'invoice.taxYear': String(inv.taxYear),
      'invoice.total': usd(inv.total),
      'invoice.balance': usd(inv.balance),
      'invoice.dueDate': longDate(inv.dueDate),
      'invoice.propertyCount': String(
        new Set(inv.lines.map((l) => l.propertyId).filter(Boolean)).size,
      ),
    });
  }
  if (delivery.paymentId) {
    const p = await db.payment.findUniqueOrThrow({ where: { id: delivery.paymentId } });
    const open = await db.invoice.findMany({
      where: { contactId: delivery.contactId, status: { in: [...OPEN_STATUSES] } },
      select: { balance: true },
    });
    Object.assign(vars, {
      'payment.amount': usd(p.amount),
      'payment.receivedAt': longDate(p.receivedAt),
      'payment.method': METHOD[p.method] ?? p.method,
      'payment.reference': p.reference ?? '',
      'client.balance': usd(sumMoney(open.map((o) => o.balance.toString()))),
    });
  }
  return vars;
}

export async function deliver(
  db: OrgDb,
  orgId: number,
  deps: MailerDeps,
  deliveryId: number,
): Promise<'SENT' | 'SKIPPED'> {
  const d = await db.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!d || (d.status !== 'QUEUED' && d.status !== 'FAILED')) return 'SKIPPED';
  try {
    const content = await templateFor(db, d.templateKey);
    const message = renderTemplate(content, await varsFor(db, d));
    const attachments: MailAttachment[] = [];
    for (const key of d.attachmentKeys) {
      attachments.push({
        filename: `Invoice ${key.split('/').at(-1)!.replace(/^\d+-/, '')}`,
        contentType: 'application/pdf',
        content: await deps.storage.get(key),
      });
    }
    const sent = await deps.mail.send({
      to: d.toEmail,
      ...message,
      orgId,
      idempotencyKey: `delivery-${d.id}`,
      tag: d.templateKey.toLowerCase(),
      attachments,
    });
    await db.emailDelivery.update({
      where: { id: d.id },
      data: {
        status: 'SENT',
        subject: message.subject,
        provider: deps.mail.name,
        providerMessageId: sent.providerMessageId,
        sentAt: new Date(),
        error: null,
      },
    });
    if (d.invoiceId)
      await db.invoice.update({ where: { id: d.invoiceId }, data: { sentAt: new Date() } });
    return 'SENT';
  } catch (e) {
    await db.emailDelivery.update({
      where: { id: d.id },
      data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }
}
