import type { OrgDb, Prisma } from '@app/db';
import {
  agingBucket,
  AGING_BUCKETS,
  cents,
  collectionRate,
  dollars,
  financePeriods,
  inRange,
  monthsEnding,
  OPEN_STATUSES,
  type AgingBucket,
  type DayRange,
  type FinanceDashboard,
  type InvoiceStatus,
} from '@app/shared';
import { currentTaxYear, day } from '../routes/tenant/mappers.js';
import { todayIn } from './billing.js';

// Finance dashboard (BUILD_PLAN 8.10). Rules:
// - Billed: invoice totals by issue date (drafts and void excluded; write-offs were billed).
// - Collected: payments by received date. With an invoice filter (tax year, county,
//   consultant, property type) only the money allocated to matching invoices counts.
// - Outstanding: balances of issued and part-paid invoices, aged by days past due.
// - Tax year means protest year, never the billing month. Archived properties are excluded.

export interface FinanceFilters {
  asOf?: string;
  from?: string;
  to?: string;
  taxYear?: number;
  countyId?: number;
  consultantId?: number;
  propertyType?: 'RESIDENTIAL' | 'COMMERCIAL' | 'BPP' | 'LAND' | 'OTHER';
  method?: 'ZELLE' | 'CHECK' | 'ACH' | 'CASH' | 'CARD' | 'OTHER';
}

type Cents = bigint;
const sum = (xs: Cents[]) => xs.reduce((a, b) => a + b, 0n);

export async function financeDashboard(db: OrgDb, f: FinanceFilters): Promise<FinanceDashboard> {
  const org = await db.org.findFirstOrThrow({
    select: { timezone: true, taxYearDefault: true, savingsBasis: true },
  });
  const asOf = f.asOf ?? todayIn(org.timezone);
  const periods = financePeriods(asOf);
  const range: DayRange = { from: f.from ?? periods.ytd.from, to: f.to ?? asOf };
  const propertyFilter: Prisma.PropertyWhereInput = {
    archivedAt: null,
    ...(f.countyId ? { countyId: f.countyId } : {}),
    ...(f.consultantId ? { consultantUserId: f.consultantId } : {}),
    ...(f.propertyType ? { propertyType: f.propertyType } : {}),
  };
  const lineFilter = f.countyId || f.consultantId || f.propertyType;
  const invoiceFilter = Boolean(lineFilter || f.taxYear);

  const invoices = await db.invoice.findMany({
    where: {
      status: { notIn: ['DRAFT', 'VOID'] },
      ...(f.taxYear ? { taxYear: f.taxYear } : {}),
      ...(lineFilter ? { lines: { some: { property: propertyFilter } } } : {}),
    },
    select: {
      id: true,
      status: true,
      total: true,
      balance: true,
      issueDate: true,
      dueDate: true,
      contact: { select: { id: true, displayName: true, clientNumber: true } },
      lines: {
        select: { amount: true, property: { select: { county: { select: { name: true } } } } },
      },
    },
  });
  const matching = new Set(invoices.map((i) => i.id));

  // Collected money as (received day, amount) pairs, after filters.
  const payments = await db.payment.findMany({
    where: { deletedAt: null, ...(f.method ? { method: f.method } : {}) },
    select: {
      id: true,
      receivedAt: true,
      amount: true,
      method: true,
      reference: true,
      contact: { select: { id: true, displayName: true } },
      allocations: { select: { invoiceId: true, amount: true } },
    },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
  });
  const collectedRows = payments
    .map((p) => ({
      p,
      day: day(p.receivedAt)!,
      amount: invoiceFilter
        ? sum(
            p.allocations
              .filter((a) => matching.has(a.invoiceId))
              .map((a) => cents(a.amount.toString())),
          )
        : cents(p.amount.toString()),
    }))
    .filter((r) => r.amount > 0n);

  const billedIn = (r: DayRange) =>
    sum(invoices.filter((i) => inRange(day(i.issueDate), r)).map((i) => cents(i.total.toString())));
  const collectedIn = (r: DayRange) =>
    sum(collectedRows.filter((c) => inRange(c.day, r)).map((c) => c.amount));
  const pair = (r: DayRange) => ({
    billed: dollars(billedIn(r)),
    collected: dollars(collectedIn(r)),
  });
  const ytd = pair(periods.ytd);

  // Outstanding and aging.
  const open = invoices.filter((i) => OPEN_STATUSES.includes(i.status as InvoiceStatus));
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0n])) as Record<
    AgingBucket,
    Cents
  >;
  for (const i of open) buckets[agingBucket(day(i.dueDate), asOf)] += cents(i.balance.toString());

  const byClient = new Map<
    number,
    { contact: (typeof open)[number]['contact']; balance: Cents; pastDue: Cents; invoices: number }
  >();
  for (const i of open) {
    const c = byClient.get(i.contact.id) ?? {
      contact: i.contact,
      balance: 0n,
      pastDue: 0n,
      invoices: 0,
    };
    const bal = cents(i.balance.toString());
    c.balance += bal;
    if (agingBucket(day(i.dueDate), asOf) !== 'NOT_DUE') c.pastDue += bal;
    c.invoices += 1;
    byClient.set(i.contact.id, c);
  }

  // Billed by county: line amounts of invoices issued in the range.
  const county = new Map<string, Cents>();
  for (const i of invoices.filter((x) => inRange(day(x.issueDate), range))) {
    for (const l of i.lines) {
      const name = l.property?.county.name ?? 'Not linked to a property';
      county.set(name, (county.get(name) ?? 0n) + cents(l.amount.toString()));
    }
  }

  // Savings delivered for the tax year (from final values, not invoices).
  const taxYear = f.taxYear ?? currentTaxYear(org);
  const market = org.savingsBasis === 'MARKET';
  const records = await db.taxYearRecord.findMany({
    where: {
      taxYear,
      property: propertyFilter,
      ...(market
        ? { finalMarket: { not: null }, noticeMarket: { not: null } }
        : { finalAppraised: { not: null }, noticeAppraised: { not: null } }),
    },
    select: {
      noticeMarket: true,
      finalMarket: true,
      noticeAppraised: true,
      finalAppraised: true,
      taxRatePct: true,
    },
  });
  let reduced = 0n;
  let saved = 0n;
  for (const r of records) {
    const diff =
      cents((market ? r.noticeMarket : r.noticeAppraised)!.toString()) -
      cents((market ? r.finalMarket : r.finalAppraised)!.toString());
    if (diff <= 0n) continue;
    reduced += diff;
    // reduction × rate% with the rate at 4 decimals, rounded half up to the cent.
    const rate = cents(r.taxRatePct?.toString() ?? '0') * 100n; // rate × 10^4
    saved += (diff * rate + 500_000n) / 1_000_000n;
  }

  // Outcomes for the selected tax year and the two before it.
  const outcomes = await db.taxYearRecord.groupBy({
    by: ['taxYear', 'resultType'],
    where: { taxYear: { in: [taxYear - 2, taxYear - 1, taxYear] }, property: propertyFilter },
    _count: { _all: true },
  });
  const outcomeRow = (y: number) => {
    const n = (t: string | null) =>
      outcomes.find((o) => o.taxYear === y && o.resultType === t)?._count._all ?? 0;
    return {
      taxYear: y,
      settled: n('SETTLEMENT'),
      boardOrder: n('BOARD_ORDER'),
      noChange: n('NO_CHANGE'),
      withdrawn: n('WITHDRAWN'),
      pending: n(null),
    };
  };

  return {
    asOf,
    range,
    kpis: {
      thisMonth: pair(periods.thisMonth),
      lastMonth: pair(periods.lastMonth),
      ytd,
      lastYear: pair(periods.lastYear),
      collectionRateYtd: collectionRate(ytd.billed, ytd.collected),
    },
    outstanding: {
      total: dollars(sum(Object.values(buckets))),
      count: open.length,
      buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, dollars(buckets[b])])) as Record<
        AgingBucket,
        string
      >,
    },
    savings: {
      taxYear,
      properties: records.length,
      valueReduced: dollars(reduced),
      taxSavings: dollars(saved),
    },
    monthly: monthsEnding(asOf, 12).map((month) => {
      const r = { from: `${month}-01`, to: `${month}-31` };
      return { month, billed: dollars(billedIn(r)), collected: dollars(collectedIn(r)) };
    }),
    byCounty: [...county.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0])))
      .map(([name, c]) => ({ county: name, billed: dollars(c) })),
    outcomes: [taxYear - 2, taxYear - 1, taxYear].map(outcomeRow),
    topOutstanding: [...byClient.values()]
      .sort((a, b) =>
        b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : a.contact.id - b.contact.id,
      )
      .slice(0, 10)
      .map((c) => ({
        contact: c.contact,
        balance: dollars(c.balance),
        pastDue: dollars(c.pastDue),
        invoices: c.invoices,
      })),
    recentPayments: collectedRows
      .filter((c) => inRange(c.day, range))
      .slice(0, 10)
      .map(({ p, day: d, amount }) => ({
        id: p.id,
        receivedAt: d,
        contact: p.contact,
        method: p.method,
        reference: p.reference,
        amount: dollars(amount),
      })),
  };
}
