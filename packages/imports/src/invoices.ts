import { cents, deriveInvoiceStatus, dollars } from '@app/shared';
import {
  parseRow,
  rowValues,
  summarize,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type Mode,
  type RowResult,
} from './common.js';

// Historical invoices (M4): balances from the firm's previous system. Matched on invoice
// number; each becomes an issued invoice with one line, plus an "Imported" payment for what
// was already paid. No fee snapshot and no protest-stage changes.

const LINE = 'Imported from your previous system';
const paymentRef = (number: string) => `Imported ${number}`;
const day = (v: string) => new Date(`${v}T00:00:00Z`);
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

interface Known {
  id: number;
  historical: boolean;
  contactId: number;
  taxYear: number;
  issueDate: string | null;
  dueDate: string | null;
  total: string;
  paid: string;
  paymentId: number | null;
}

export async function importInvoices(
  ctx: ImportContext,
  input: ImportInput,
  mode: Mode,
): Promise<ImportOutcome> {
  const { db, orgId, actorUserId } = ctx;
  const rows = rowValues(input).map((values) => ({
    values,
    ...parseRow('HISTORICAL_INVOICES', values),
  }));

  const contacts = await db.contact.findMany({
    select: { id: true, clientNumber: true, email: true, displayName: true },
  });
  const byNumber = new Map(contacts.filter((c) => c.clientNumber).map((c) => [c.clientNumber!, c]));
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const byName = new Map<string, (typeof contacts)[number][]>();
  for (const c of contacts) {
    const k = c.displayName.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }

  const numbers = [
    ...new Set(rows.map((r) => r.values.get('invoiceNumber')).filter(Boolean)),
  ] as string[];
  const known = new Map<string, Known>();
  for (let i = 0; i < numbers.length; i += 1000) {
    for (const inv of await db.invoice.findMany({
      where: { number: { in: numbers.slice(i, i + 1000) } },
      include: {
        allocations: {
          include: { payment: { select: { id: true, reference: true, deletedAt: true } } },
        },
      },
    })) {
      const imported = inv.allocations.find(
        (a) => a.payment.reference === paymentRef(inv.number!) && !a.payment.deletedAt,
      );
      known.set(inv.number!, {
        id: inv.id,
        historical: inv.historical,
        contactId: inv.contactId,
        taxYear: inv.taxYear,
        issueDate: dayOf(inv.issueDate),
        dueDate: dayOf(inv.dueDate),
        total: inv.total.toFixed(2),
        paid: imported ? imported.amount.toFixed(2) : '0.00',
        paymentId: imported?.payment.id ?? null,
      });
    }
  }

  let tempId = -1;
  const results: RowResult[] = [];
  for (const [i, row] of rows.entries()) {
    const rowNumber = i + 1;
    const messages = [...row.errors, ...row.warnings];
    const number = row.values.get('invoiceNumber') ?? null;
    const label = [number, row.values.get('clientName')].filter(Boolean).join(' · ') || null;
    const fail = (m?: string) =>
      results.push({
        rowNumber,
        action: 'ERROR',
        label,
        changes: [],
        messages: m ? [m, ...messages] : messages,
      });
    if (row.errors.length) {
      fail();
      continue;
    }
    const missing = (
      [
        ['invoiceNumber', 'invoice number'],
        ['taxYear', 'tax year'],
        ['issueDate', 'invoice date'],
        ['total', 'total'],
      ] as const
    ).filter(([k]) => !row.parsed.has(k));
    if (missing.length) {
      fail(`Missing ${missing.map(([, l]) => l).join(', ')}.`);
      continue;
    }

    const clientNumber = row.values.get('clientNumber');
    const email = row.parsed.get('email') as string | undefined;
    const name = row.values.get('clientName')?.trim().toLowerCase();
    const named = name ? byName.get(name) : undefined;
    const contact =
      (clientNumber ? byNumber.get(clientNumber) : undefined) ??
      (email ? byEmail.get(email) : undefined) ??
      (named?.length === 1 ? named[0] : undefined);
    if (!contact) {
      fail(
        named && named.length > 1
          ? `Several clients are named "${row.values.get('clientName')}". Add the client number.`
          : 'No matching client. Import clients first, or add the client number.',
      );
      continue;
    }

    const total = row.parsed.get('total') as string;
    const paid = (row.parsed.get('amountPaid') as string | undefined) ?? '0';
    if (cents(paid) > cents(total)) {
      fail('Amount paid is more than the invoice total.');
      continue;
    }
    const taxYear = row.parsed.get('taxYear') as number;
    const issueDate = row.parsed.get('issueDate') as string;
    const dueDate = (row.parsed.get('dueDate') as string | undefined) ?? issueDate;
    const paidAt = (row.parsed.get('paidAt') as string | undefined) ?? issueDate;
    const status = deriveInvoiceStatus('ISSUED', total, paid);
    const balance = dollars(cents(total) - cents(paid));
    const invoiceData = {
      contactId: contact.id,
      taxYear,
      issueDate: day(issueDate),
      dueDate: day(dueDate),
      subtotal: total,
      total,
      amountPaid: paid,
      balance,
      status,
    };

    try {
      const existing = known.get(number!);
      if (!existing) {
        let id = tempId--;
        let paymentId: number | null = null;
        if (mode === 'apply') {
          const inv = await db.invoice.create({
            data: {
              orgId,
              number: number!,
              historical: true,
              createdById: actorUserId,
              notes: (row.parsed.get('notes') as string | undefined) ?? null,
              ...invoiceData,
            },
            select: { id: true },
          });
          id = inv.id;
          await db.invoiceLine.create({
            data: { orgId, invoiceId: id, kind: 'ADJUSTMENT', description: LINE, amount: total },
          });
          if (cents(paid) > 0n)
            paymentId = await addPayment(ctx, contact.id, id, number!, paid, paidAt);
        }
        known.set(number!, {
          id,
          historical: true,
          contactId: contact.id,
          taxYear,
          issueDate,
          dueDate,
          total: dollars(cents(total)),
          paid: dollars(cents(paid)),
          paymentId,
        });
        results.push({
          rowNumber,
          action: 'CREATE',
          label: `${number} · ${contact.displayName}`,
          changes: [],
          messages,
        });
        continue;
      }
      if (!existing.historical) {
        fail(`Invoice ${number} was issued in ProtestOS; it can't be overwritten by an import.`);
        continue;
      }
      const changes: string[] = [];
      if (existing.contactId !== contact.id) changes.push('client');
      if (existing.taxYear !== taxYear) changes.push('tax year');
      if (existing.issueDate !== issueDate) changes.push('invoice date');
      if (existing.dueDate !== dueDate) changes.push('due date');
      if (cents(existing.total) !== cents(total)) changes.push('total');
      const paidChanged = cents(existing.paid) !== cents(paid);
      if (paidChanged) changes.push('amount paid');
      if (changes.length && mode === 'apply' && existing.id > 0) {
        await db.invoice.update({ where: { id: existing.id }, data: invoiceData });
        await db.invoiceLine.updateMany({
          where: { invoiceId: existing.id },
          data: { amount: total },
        });
        if (paidChanged) {
          if (existing.paymentId) {
            await db.paymentAllocation.deleteMany({ where: { paymentId: existing.paymentId } });
            await db.payment.update({
              where: { id: existing.paymentId },
              data: { deletedAt: new Date() },
            });
          }
          existing.paymentId =
            cents(paid) > 0n
              ? await addPayment(ctx, contact.id, existing.id, number!, paid, paidAt)
              : null;
        }
      }
      Object.assign(existing, { contactId: contact.id, taxYear, issueDate, dueDate, total, paid });
      results.push({
        rowNumber,
        action: changes.length ? 'UPDATE' : 'UNCHANGED',
        label: `${number} · ${contact.displayName}`,
        changes,
        messages,
      });
    } catch (e) {
      fail(`Couldn't save the invoice: ${(e as Error).message.split('\n').at(-1)}`);
    }
  }
  return { rows: results, summary: summarize(results) };
}

async function addPayment(
  ctx: ImportContext,
  contactId: number,
  invoiceId: number,
  number: string,
  amount: string,
  paidAt: string,
) {
  const p = await ctx.db.payment.create({
    data: {
      orgId: ctx.orgId,
      contactId,
      receivedAt: day(paidAt),
      amount,
      method: 'OTHER',
      reference: paymentRef(number),
      createdById: ctx.actorUserId,
    },
    select: { id: true },
  });
  await ctx.db.paymentAllocation.create({
    data: { orgId: ctx.orgId, paymentId: p.id, invoiceId, amount },
  });
  return p.id;
}
