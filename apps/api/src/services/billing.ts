import type { OrgDb, Prisma } from '@app/db';
import { renderInvoicePdf, renderStatementPdf, type InvoicePdfLine } from '@app/pdf';
import type { StorageProvider } from '@app/providers';
import {
  addDays,
  allocateOldestFirst,
  calculateFee,
  cents,
  checkAllocations,
  chooseTemplate,
  deriveInvoiceStatus,
  dollars,
  formatInvoiceNumber,
  isPastDue,
  OPEN_STATUSES,
  PROTEST_STAGES,
  resolveFeeTerms,
  SYSTEM_STAGES,
  sumMoney,
  type Allocation,
  type CreatePaymentData,
  type FeeResult,
  type GenerateInvoicesInput,
  type GeneratePreview,
  type InvoiceLineKind,
  type InvoiceStatus,
  type InvoiceTemplate,
  type ProtestStage,
} from '@app/shared';
import { badRequest, conflict, notFound } from '../errors.js';
import { address, currentTaxYear, day, money, toDay } from '../routes/tenant/mappers.js';

// Invoicing and payments (BUILD_PLAN 5.6, 8.6, 8.7). Every query runs in its own transaction
// (ADR 003), so multi-step writes undo themselves on failure where it matters.

type Db = OrgDb;

/** Today's date in the firm's time zone, as YYYY-MM-DD. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

const FIRM_SELECT = {
  id: true,
  name: true,
  timezone: true,
  addressLines: true,
  phone: true,
  website: true,
  primaryColor: true,
  paymentInstructions: true,
  defaultContingencyPct: true,
  defaultFlatFee: true,
  defaultBppFee: true,
  taxYearDefault: true,
  savingsBasis: true,
  flatFeeCurrentYearOnly: true,
  invoiceGrouping: true,
  invoicePrefix: true,
  invoiceDueDays: true,
} as const;

async function firm(db: Db) {
  return db.org.findFirstOrThrow({ select: FIRM_SELECT });
}
type Firm = Awaited<ReturnType<typeof firm>>;

// ---------------------------------------------------------------------------
// Fee lines for one property-year

const RECORD_INCLUDE = {
  property: {
    include: {
      county: { select: { name: true } },
      contact: {
        select: {
          id: true,
          displayName: true,
          clientNumber: true,
          contingencyPct: true,
          flatFee: true,
          bppFee: true,
        },
      },
    },
  },
} as const;

type RecordRow = Prisma.TaxYearRecordGetPayload<{ include: typeof RECORD_INCLUDE }>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

interface FeeLine {
  kind: InvoiceLineKind;
  description: string;
  amount: string;
  snapshot: Record<string, unknown>;
}

/** Builds the fee lines for one property-year, or a reason it can't be billed. */
function feeLinesFor(
  rec: RecordRow,
  org: Firm,
): { lines: FeeLine[]; fee: FeeResult } | { skip: string } {
  const p = rec.property;
  const terms = resolveFeeTerms({
    taxYear: {
      contingencyPctOverride: str(rec.contingencyPctOverride),
      bppFee: str(rec.bppFee),
      bppRenderedAt: rec.bppRenderedAt,
    },
    property: {
      contingencyPct: str(p.contingencyPct),
      flatFee: str(p.flatFee),
      bppFee: str(p.bppFee),
    },
    client: {
      contingencyPct: str(p.contact.contingencyPct),
      flatFee: str(p.contact.flatFee),
      bppFee: str(p.contact.bppFee),
    },
    firm: {
      defaultContingencyPct: org.defaultContingencyPct.toString(),
      defaultFlatFee: org.defaultFlatFee.toString(),
      defaultBppFee: org.defaultBppFee.toString(),
    },
  });
  const fee = calculateFee({
    noticeMarket: str(rec.noticeMarket),
    finalMarket: str(rec.finalMarket),
    noticeAppraised: str(rec.noticeAppraised),
    finalAppraised: str(rec.finalAppraised),
    taxRatePct: str(rec.taxRatePct),
    contingencyPct: terms.contingencyPct.value,
    flatFee: terms.flatFee.value,
    bppFee: terms.bppFee?.value ?? '0',
    applyFlatFee: !org.flatFeeCurrentYearOnly || rec.taxYear === currentTaxYear(org),
    savingsBasis: org.savingsBasis,
  });
  if (fee.status === 'INCOMPLETE') {
    const what = fee.missing.map(
      (m) => ({ noticeValue: 'notice value', finalValue: 'final value', taxRate: 'tax rate' })[m],
    );
    return { skip: `Missing the ${what.join(' and ')}.` };
  }
  const snapshot = {
    taxYear: rec.taxYear,
    savingsBasis: org.savingsBasis,
    values: {
      noticeMarket: str(rec.noticeMarket),
      finalMarket: str(rec.finalMarket),
      noticeAppraised: str(rec.noticeAppraised),
      finalAppraised: str(rec.finalAppraised),
      taxRatePct: str(rec.taxRatePct),
    },
    homestead: rec.homestead,
    underArbitration: rec.underArbitration,
    terms: {
      contingencyPct: terms.contingencyPct,
      flatFee: terms.flatFee,
      bppFee: terms.bppFee,
    },
    fee,
  };
  const lines: FeeLine[] = [];
  if (fee.contingencyFee && cents(fee.contingencyFee) > 0n) {
    lines.push({
      kind: 'CONTINGENCY',
      description: `Contingency fee (${Number(fee.contingencyPct)}% of tax saved)`,
      amount: fee.contingencyFee,
      snapshot,
    });
  }
  if (cents(fee.flatFee) > 0n)
    lines.push({ kind: 'FLAT', description: 'Flat service fee', amount: fee.flatFee, snapshot });
  if (cents(fee.bppFee) > 0n)
    lines.push({
      kind: 'BPP',
      description: 'Business personal property rendition',
      amount: fee.bppFee,
      snapshot,
    });
  if (!lines.length) return { skip: 'No fee due: no reduction and no flat fee.' };
  return { lines, fee };
}

const propertyLabel = (rec: RecordRow) =>
  `${rec.property.county.name} ${rec.property.accountNumber}`;

// ---------------------------------------------------------------------------
// Generate drafts (BUILD_PLAN 8.6)

/** Property-years for the year with a final value and no live invoice yet. */
async function eligibleRecords(db: Db, org: Firm, input: GenerateInvoicesInput) {
  const finalField = org.savingsBasis === 'MARKET' ? 'finalMarket' : 'finalAppraised';
  return await db.taxYearRecord.findMany({
    where: {
      taxYear: input.taxYear,
      [finalField]: { not: null },
      invoiceLines: { none: { invoice: { status: { not: 'VOID' } } } },
      property: {
        archivedAt: null,
        ...(input.countyIds?.length ? { countyId: { in: input.countyIds } } : {}),
        ...(input.consultantIds?.length ? { consultantUserId: { in: input.consultantIds } } : {}),
        contact: {
          kind: 'CLIENT',
          archivedAt: null,
          ...(input.contactIds?.length ? { id: { in: input.contactIds } } : {}),
        },
      },
    },
    include: RECORD_INCLUDE,
    orderBy: [{ property: { contact: { displayName: 'asc' } } }, { propertyId: 'asc' }],
  });
}

export async function generateInvoices(
  db: Db,
  orgId: number,
  input: GenerateInvoicesInput,
  mode: 'preview' | 'create',
  actorUserId: number | null,
): Promise<GeneratePreview & { createdIds: number[] }> {
  const org = await firm(db);
  const records = await eligibleRecords(db, org, input);
  const groups = new Map<
    string,
    { contact: RecordRow['property']['contact']; items: { rec: RecordRow; lines: FeeLine[] }[] }
  >();
  const skipped: GeneratePreview['skipped'] = [];
  for (const rec of records) {
    const r = feeLinesFor(rec, org);
    if ('skip' in r) {
      skipped.push({
        property: propertyLabel(rec),
        client: rec.property.contact.displayName,
        reason: r.skip,
      });
      continue;
    }
    const key =
      org.invoiceGrouping === 'PROPERTY_YEAR'
        ? `p${rec.propertyId}`
        : `c${rec.property.contact.id}`;
    const g = groups.get(key) ?? { contact: rec.property.contact, items: [] };
    g.items.push({ rec, lines: r.lines });
    groups.set(key, g);
  }

  const invoices = [...groups.values()].map((g) => {
    const flat = g.items.flatMap((i) => i.lines.map((l) => ({ ...l, rec: i.rec })));
    return {
      contact: {
        id: g.contact.id,
        displayName: g.contact.displayName,
        clientNumber: g.contact.clientNumber,
      },
      template: chooseTemplate(
        flat.map((l) => ({
          kind: l.kind,
          amount: l.amount,
          homestead: l.rec.homestead,
          underArbitration: l.rec.underArbitration,
        })),
      ),
      total: sumMoney(flat.map((l) => l.amount)),
      lines: flat.map((l) => ({
        taxYearRecordId: l.rec.id,
        property: propertyLabel(l.rec),
        kind: l.kind,
        description: l.description,
        amount: l.amount,
      })),
      flat,
    };
  });

  const createdIds: number[] = [];
  if (mode === 'create') {
    for (const inv of invoices) {
      const created = await db.invoice.create({
        data: {
          orgId,
          contactId: inv.contact.id,
          taxYear: input.taxYear,
          template: inv.template,
          subtotal: inv.total,
          total: inv.total,
          balance: inv.total,
          createdById: actorUserId,
        },
        select: { id: true },
      });
      try {
        await db.invoiceLine.createMany({
          data: inv.flat.map((l, i) => ({
            orgId,
            invoiceId: created.id,
            propertyId: l.rec.propertyId,
            taxYearRecordId: l.rec.id,
            kind: l.kind,
            description: l.description,
            amount: l.amount,
            snapshot: l.snapshot as object,
            sortOrder: i,
          })),
        });
      } catch (e) {
        await db.invoice.delete({ where: { id: created.id } });
        throw e;
      }
      createdIds.push(created.id);
    }
  }

  return {
    taxYear: input.taxYear,
    grouping: org.invoiceGrouping,
    invoices: invoices.map(({ flat: _flat, ...i }) => i),
    skipped,
    total: sumMoney(invoices.map((i) => i.total)),
    createdIds,
  };
}

// ---------------------------------------------------------------------------
// Totals, status and protest stage

async function moveStage(
  db: Db,
  orgId: number,
  recordIds: number[],
  from: ProtestStage[],
  to: ProtestStage | 'BEFORE_INVOICE',
  note: string,
  actorUserId: number | null,
) {
  if (!recordIds.length) return;
  const recs = await db.taxYearRecord.findMany({
    where: { id: { in: recordIds }, protestStage: { in: from } },
    select: { id: true, protestStage: true },
  });
  for (const r of recs) {
    let target: ProtestStage;
    if (to === 'BEFORE_INVOICE') {
      const ev = await db.protestStageEvent.findFirst({
        where: { taxYearRecordId: r.id, toStage: 'INVOICED' },
        orderBy: { at: 'desc' },
        select: { fromStage: true },
      });
      target = ev?.fromStage ?? 'NOT_STARTED';
    } else target = to;
    if (target === r.protestStage) continue;
    await db.taxYearRecord.update({ where: { id: r.id }, data: { protestStage: target } });
    await db.protestStageEvent.create({
      data: {
        orgId,
        taxYearRecordId: r.id,
        fromStage: r.protestStage,
        toStage: target,
        note,
        actorUserId,
      },
    });
  }
}

/** Recomputes totals and the derived status from lines and live allocations. */
export async function recalcInvoice(
  db: Db,
  orgId: number,
  invoiceId: number,
  actorUserId: number | null,
) {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { select: { amount: true, taxYearRecordId: true } },
      allocations: { where: { payment: { deletedAt: null } }, select: { amount: true } },
    },
  });
  if (!inv) return;
  const total = sumMoney(inv.lines.map((l) => l.amount.toString()));
  const paid = sumMoney(inv.allocations.map((a) => a.amount.toString()));
  const status = deriveInvoiceStatus(inv.status, total, paid);
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: total,
      total,
      amountPaid: paid,
      balance: dollars(cents(total) - cents(paid)),
      status,
    },
  });
  const recordIds = [
    ...new Set(inv.lines.map((l) => l.taxYearRecordId).filter((x): x is number => x !== null)),
  ];
  if (status === 'PAID' && inv.status !== 'PAID') {
    await moveStage(
      db,
      orgId,
      recordIds,
      ['INVOICED'],
      'PAID',
      `Invoice ${inv.number} paid`,
      actorUserId,
    );
  } else if (inv.status === 'PAID' && status !== 'PAID') {
    await moveStage(
      db,
      orgId,
      recordIds,
      ['PAID'],
      'INVOICED',
      `Invoice ${inv.number} reopened`,
      actorUserId,
    );
  }
}

// ---------------------------------------------------------------------------
// Draft editing, issue, void, write off

async function draftOf(db: Db, id: number) {
  const inv = await db.invoice.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!inv) throw notFound('That invoice was not found.');
  if (inv.status !== 'DRAFT')
    throw conflict('Only draft invoices can be changed. Void it instead.');
  return inv;
}

export async function addAdjustment(
  db: Db,
  orgId: number,
  id: number,
  input: { description: string; amount: string },
) {
  await draftOf(db, id);
  const last = await db.invoiceLine.findFirst({
    where: { invoiceId: id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  await db.invoiceLine.create({
    data: {
      orgId,
      invoiceId: id,
      kind: 'ADJUSTMENT',
      description: input.description,
      amount: input.amount,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  await recalcInvoice(db, orgId, id, null);
}

export async function removeLine(db: Db, orgId: number, id: number, lineId: number) {
  await draftOf(db, id);
  const { count } = await db.invoiceLine.deleteMany({ where: { id: lineId, invoiceId: id } });
  if (!count) throw notFound('That line was not found.');
  const left = await db.invoiceLine.count({ where: { invoiceId: id } });
  if (!left) {
    await db.invoice.delete({ where: { id } });
    return { deleted: true };
  }
  await recalcInvoice(db, orgId, id, null);
  return { deleted: false };
}

export async function deleteDraft(db: Db, id: number) {
  await draftOf(db, id);
  await db.invoice.delete({ where: { id } });
}

/**
 * Issues a draft: recalculates its fee lines from current values and freezes them, assigns the
 * next number, sets dates, stores the PDF and moves each property-year to INVOICED.
 */
export async function issueInvoice(
  db: Db,
  orgId: number,
  storage: StorageProvider,
  id: number,
  input: { issueDate?: string; dueDate?: string },
  actorUserId: number | null,
) {
  await draftOf(db, id);
  const org = await firm(db);
  const lines = await db.invoiceLine.findMany({
    where: { invoiceId: id },
    orderBy: { sortOrder: 'asc' },
  });
  // Refresh fee lines from today's values, so a draft never issues stale amounts.
  const recordIds = [
    ...new Set(lines.map((l) => l.taxYearRecordId).filter((x): x is number => x !== null)),
  ];
  const records = await db.taxYearRecord.findMany({
    where: { id: { in: recordIds } },
    include: RECORD_INCLUDE,
  });
  const fresh = new Map<number, FeeLine[]>();
  for (const rec of records) {
    const r = feeLinesFor(rec, org);
    if ('skip' in r) throw badRequest(`${propertyLabel(rec)}: ${r.skip}`);
    fresh.set(rec.id, r.lines);
  }
  for (const l of lines) {
    if (l.kind === 'ADJUSTMENT' || l.taxYearRecordId === null) continue;
    const match = fresh.get(l.taxYearRecordId)?.find((f) => f.kind === l.kind);
    if (!match) {
      await db.invoiceLine.delete({ where: { id: l.id } });
    } else {
      await db.invoiceLine.update({
        where: { id: l.id },
        data: {
          amount: match.amount,
          description: match.description,
          snapshot: match.snapshot as object,
        },
      });
    }
    fresh.set(
      l.taxYearRecordId,
      fresh.get(l.taxYearRecordId)!.filter((f) => f !== match),
    );
  }
  for (const [recId, extra] of fresh) {
    const rec = records.find((r) => r.id === recId)!;
    for (const f of extra) {
      await db.invoiceLine.create({
        data: {
          orgId,
          invoiceId: id,
          propertyId: rec.propertyId,
          taxYearRecordId: recId,
          kind: f.kind,
          description: f.description,
          amount: f.amount,
          snapshot: f.snapshot as object,
          sortOrder: 1000,
        },
      });
    }
  }
  const after = await db.invoiceLine.findMany({
    where: { invoiceId: id },
    select: { amount: true },
  });
  const total = sumMoney(after.map((l) => l.amount.toString()));
  if (cents(total) <= 0n) throw badRequest('The invoice total must be more than zero to issue it.');

  const issueDate = input.issueDate ?? todayIn(org.timezone);
  const dueDate = input.dueDate ?? addDays(issueDate, org.invoiceDueDays);
  if (dueDate < issueDate) throw badRequest("The due date can't be before the issue date.");

  // Reserve a number (row-locked increment). Skip numbers already used, e.g. after a prefix change.
  let number = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const o = await db.org.update({
      where: { id: orgId },
      data: { nextInvoiceNumber: { increment: 1 } },
      select: { nextInvoiceNumber: true, invoicePrefix: true },
    });
    number = formatInvoiceNumber(o.invoicePrefix, o.nextInvoiceNumber - 1);
    if (!(await db.invoice.findFirst({ where: { number }, select: { id: true } }))) break;
  }
  await db.invoice.update({
    where: { id },
    data: { status: 'ISSUED', number, issueDate: toDay(issueDate), dueDate: toDay(dueDate) },
  });
  await recalcInvoice(db, orgId, id, actorUserId);
  await moveStage(
    db,
    orgId,
    recordIds,
    PROTEST_STAGES.filter((st) => !SYSTEM_STAGES.includes(st)),
    'INVOICED',
    `Invoice ${number}`,
    actorUserId,
  );
  await storeInvoicePdf(db, storage, id);
  return number;
}

/** Renders the issued invoice and stores it; its pdfKey points at the frozen copy. */
export async function storeInvoicePdf(db: Db, storage: StorageProvider, id: number) {
  const bytes = await invoicePdf(db, id);
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id },
    select: { orgId: true, number: true },
  });
  const key = `org/${inv.orgId}/invoices/${id}-${inv.number}.pdf`;
  await storage.put(key, Buffer.from(bytes), 'application/pdf');
  await db.invoice.update({ where: { id }, data: { pdfKey: key } });
}

export async function voidInvoice(
  db: Db,
  orgId: number,
  id: number,
  reason: string,
  actorUserId: number | null,
) {
  const inv = await db.invoice.findUnique({
    where: { id },
    select: { id: true, status: true, number: true, lines: { select: { taxYearRecordId: true } } },
  });
  if (!inv) throw notFound('That invoice was not found.');
  if (inv.status === 'DRAFT') throw conflict('Delete a draft instead of voiding it.');
  if (inv.status === 'VOID') throw conflict('This invoice is already void.');
  // Money applied to it goes back to the client's credit.
  const released = await db.paymentAllocation.findMany({
    where: { invoiceId: id },
    select: { amount: true },
  });
  await db.paymentAllocation.deleteMany({ where: { invoiceId: id } });
  await db.invoice.update({
    where: { id },
    data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, amountPaid: 0, balance: 0 },
  });
  const recordIds = [
    ...new Set(inv.lines.map((l) => l.taxYearRecordId).filter((x): x is number => x !== null)),
  ];
  await moveStage(
    db,
    orgId,
    recordIds,
    ['INVOICED', 'PAID'],
    'BEFORE_INVOICE',
    `Invoice ${inv.number} voided`,
    actorUserId,
  );
  return sumMoney(released.map((a) => a.amount.toString()));
}

export async function writeOffInvoice(db: Db, id: number, reason: string) {
  const inv = await db.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!inv) throw notFound('That invoice was not found.');
  if (!OPEN_STATUSES.includes(inv.status as InvoiceStatus))
    throw conflict('Only issued, unpaid or part-paid invoices can be written off.');
  await db.invoice.update({
    where: { id },
    data: { status: 'WRITTEN_OFF', writtenOffAt: new Date(), writeOffReason: reason },
  });
}

// ---------------------------------------------------------------------------
// Payments and credit (BUILD_PLAN 8.7)

async function openInvoicesOf(db: Db, contactId: number) {
  return db.invoice.findMany({
    where: { contactId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, balance: true, dueDate: true, issueDate: true },
  });
}

const asOpen = (rows: Awaited<ReturnType<typeof openInvoicesOf>>) =>
  rows.map((r) => ({
    id: r.id,
    balance: r.balance.toString(),
    dueDate: day(r.dueDate),
    issueDate: day(r.issueDate),
  }));

export async function createPayment(
  db: Db,
  orgId: number,
  input: CreatePaymentData,
  actorUserId: number | null,
) {
  const contact = await db.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true },
  });
  if (!contact) throw notFound('That client was not found.');
  const open = asOpen(await openInvoicesOf(db, input.contactId));
  let allocations: Allocation[];
  if (input.allocations) {
    allocations = input.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amount: String(a.amount),
    }));
    const problem = checkAllocations(
      input.amount,
      allocations,
      new Map(open.map((o) => [o.id, o.balance])),
    );
    if (problem) throw badRequest(problem);
  } else {
    allocations = allocateOldestFirst(input.amount, open).allocations;
  }
  const payment = await db.payment.create({
    data: {
      orgId,
      contactId: input.contactId,
      receivedAt: toDay(input.receivedAt)!,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdById: actorUserId,
    },
    select: { id: true },
  });
  if (allocations.length) {
    await db.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        orgId,
        paymentId: payment.id,
        invoiceId: a.invoiceId,
        amount: a.amount,
      })),
    });
  }
  for (const a of allocations) await recalcInvoice(db, orgId, a.invoiceId, actorUserId);
  return payment.id;
}

export async function deletePayment(db: Db, orgId: number, id: number, actorUserId: number | null) {
  const p = await db.payment.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, allocations: { select: { invoiceId: true } } },
  });
  if (!p || p.deletedAt) throw notFound('That payment was not found.');
  await db.paymentAllocation.deleteMany({ where: { paymentId: id } });
  await db.payment.update({ where: { id }, data: { deletedAt: new Date() } });
  for (const a of p.allocations) await recalcInvoice(db, orgId, a.invoiceId, actorUserId);
}

/** Unallocated money per payment (live payments only), oldest payment first. */
async function creditsOf(db: Db, contactId: number) {
  const payments = await db.payment.findMany({
    where: { contactId, deletedAt: null },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, allocations: { select: { amount: true } } },
  });
  return payments
    .map((p) => ({
      id: p.id,
      left:
        cents(p.amount.toString()) -
        p.allocations.reduce((s, a) => s + cents(a.amount.toString()), 0n),
    }))
    .filter((p) => p.left > 0n);
}

export async function clientCredit(db: Db, contactId: number) {
  return dollars((await creditsOf(db, contactId)).reduce((s, p) => s + p.left, 0n));
}

/** Applies the client's credit to their open invoices, oldest first. Returns the amount applied. */
export async function applyCredit(
  db: Db,
  orgId: number,
  contactId: number,
  actorUserId: number | null,
) {
  const contact = await db.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  if (!contact) throw notFound('That client was not found.');
  let open = asOpen(await openInvoicesOf(db, contactId));
  let applied = 0n;
  const touched = new Set<number>();
  for (const credit of await creditsOf(db, contactId)) {
    const { allocations } = allocateOldestFirst(dollars(credit.left), open);
    for (const a of allocations) {
      await db.paymentAllocation.upsert({
        where: { paymentId_invoiceId: { paymentId: credit.id, invoiceId: a.invoiceId } },
        create: { orgId, paymentId: credit.id, invoiceId: a.invoiceId, amount: a.amount },
        update: { amount: { increment: a.amount } },
      });
      applied += cents(a.amount);
      touched.add(a.invoiceId);
      open = open.map((o) =>
        o.id === a.invoiceId ? { ...o, balance: dollars(cents(o.balance) - cents(a.amount)) } : o,
      );
    }
  }
  for (const id of touched) await recalcInvoice(db, orgId, id, actorUserId);
  return dollars(applied);
}

// ---------------------------------------------------------------------------
// PDFs

const pdfOrg = (o: Firm) => ({
  name: o.name,
  addressLines: o.addressLines,
  phone: o.phone,
  website: o.website,
  primaryColor: o.primaryColor,
  paymentInstructions: o.paymentInstructions,
});

function billToOf(c: {
  displayName: string;
  email: string | null;
  billingEmail: string | null;
  mailingAddress: unknown;
}) {
  const a = address(c.mailingAddress);
  const lines = a
    ? [
        a.line1,
        a.line2,
        [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      ]
    : [];
  return {
    name: c.displayName,
    email: c.billingEmail ?? c.email,
    addressLines: lines.filter((l): l is string => Boolean(l && l.trim())),
  };
}
export { billToOf };

type Snapshot = {
  savingsBasis?: string;
  values?: Record<string, string | null>;
  fee?: FeeResult;
};

export async function invoicePdf(db: Db, id: number): Promise<Uint8Array> {
  const org = await firm(db);
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      contact: {
        select: { displayName: true, email: true, billingEmail: true, mailingAddress: true },
      },
      lines: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          property: {
            select: { accountNumber: true, situsLine: true, county: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!inv) throw notFound('That invoice was not found.');
  return renderInvoicePdf({
    org: pdfOrg(org),
    invoice: {
      number: inv.number,
      status: inv.status,
      template: inv.template as InvoiceTemplate,
      taxYear: inv.taxYear,
      issueDate: day(inv.issueDate),
      dueDate: day(inv.dueDate),
      subtotal: money(inv.subtotal)!,
      total: money(inv.total)!,
      amountPaid: money(inv.amountPaid)!,
      balance: money(inv.balance)!,
      notes: inv.notes,
    },
    billTo: billToOf(inv.contact),
    lines: inv.lines.map((l): InvoicePdfLine => {
      const s = (l.snapshot ?? null) as Snapshot | null;
      const basis = s?.savingsBasis === 'MARKET' ? 'Market' : 'Appraised';
      return {
        kind: l.kind,
        description: l.description,
        amount: money(l.amount)!,
        property: l.property
          ? {
              accountNumber: l.property.accountNumber,
              county: l.property.county.name,
              situsLine: l.property.situsLine,
            }
          : null,
        detail:
          l.kind === 'CONTINGENCY' && s?.fee
            ? {
                notice: s.values?.[`notice${basis}`] ?? null,
                final: s.values?.[`final${basis}`] ?? null,
                reduction: s.fee.reduction,
                taxRatePct: s.values?.taxRatePct ?? null,
                savings: s.fee.taxableSavings,
                contingencyPct: s.fee.contingencyPct,
              }
            : null,
      };
    }),
  });
}

export async function statementPdf(db: Db, contactId: number): Promise<Uint8Array> {
  const org = await firm(db);
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: {
      displayName: true,
      clientNumber: true,
      email: true,
      billingEmail: true,
      mailingAddress: true,
    },
  });
  if (!contact) throw notFound('That client was not found.');
  const today = todayIn(org.timezone);
  const invoices = await db.invoice.findMany({
    where: { contactId, status: { in: [...OPEN_STATUSES] } },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
  });
  const payments = await db.payment.findMany({
    where: { contactId, deletedAt: null },
    orderBy: { receivedAt: 'desc' },
    take: 10,
  });
  const credit = await clientCredit(db, contactId);
  const open = sumMoney(invoices.map((i) => i.balance.toString()));
  const due = cents(open) - cents(credit);
  return renderStatementPdf({
    org: pdfOrg(org),
    asOf: today,
    client: {
      name: contact.displayName,
      clientNumber: contact.clientNumber,
      addressLines: billToOf(contact).addressLines,
    },
    invoices: invoices.map((i) => ({
      number: i.number ?? '-',
      taxYear: i.taxYear,
      issueDate: day(i.issueDate),
      dueDate: day(i.dueDate),
      total: money(i.total)!,
      amountPaid: money(i.amountPaid)!,
      balance: money(i.balance)!,
      pastDue: isPastDue(i.status as InvoiceStatus, day(i.dueDate), today),
    })),
    payments: payments.map((p) => ({
      receivedAt: day(p.receivedAt)!,
      method: p.method,
      reference: p.reference,
      amount: money(p.amount)!,
    })),
    credit,
    balanceDue: dollars(due > 0n ? due : 0n),
  });
}
