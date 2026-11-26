import { fromScaled, toScaled, type DecimalLike } from '../fees/decimal.js';

// Billing rules (BUILD_PLAN 5.6, 8.6, 8.7). Pure: money is handled in cents as BigInt.

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'WRITTEN_OFF',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_TEMPLATES = ['STANDARD', 'ARBITRATION', 'HOMESTEAD', 'ZERO_SAVINGS'] as const;
export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];
export const INVOICE_LINE_KINDS = ['CONTINGENCY', 'FLAT', 'BPP', 'ADJUSTMENT'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];
export const PAYMENT_METHODS = ['ZELLE', 'CHECK', 'ACH', 'CASH', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const INVOICE_GROUPINGS = ['CLIENT_YEAR', 'PROPERTY_YEAR'] as const;
export type InvoiceGrouping = (typeof INVOICE_GROUPINGS)[number];

/** Invoices that can still receive payments. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID'];

export const cents = (v: DecimalLike) => toScaled(v, 2);
export const dollars = (c: bigint) => fromScaled(c, 2);

/**
 * Status after a change to lines or payments. DRAFT, VOID and WRITTEN_OFF are set by hand and
 * never change here; an issued invoice is PAID, PARTIALLY_PAID or ISSUED by what's been paid.
 */
export function deriveInvoiceStatus(
  current: InvoiceStatus,
  total: DecimalLike,
  amountPaid: DecimalLike,
): InvoiceStatus {
  if (current === 'DRAFT' || current === 'VOID' || current === 'WRITTEN_OFF') return current;
  const paid = cents(amountPaid);
  if (paid >= cents(total)) return 'PAID';
  return paid > 0n ? 'PARTIALLY_PAID' : 'ISSUED';
}

/** Past due is derived, never stored: open and due before today (YYYY-MM-DD). */
export function isPastDue(status: InvoiceStatus, dueDate: string | null, today: string): boolean {
  return OPEN_STATUSES.includes(status) && dueDate !== null && dueDate < today;
}

export const AGING_BUCKETS = ['NOT_DUE', '0-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const DAY_MS = 86_400_000;

/** Days past due, by calendar date: due 2026-03-01, today 2026-03-31 → 30 → "0-30". */
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  if (dueDate === null || dueDate >= today) return 'NOT_DUE';
  const days = Math.round((Date.parse(today) - Date.parse(dueDate)) / DAY_MS);
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export interface OpenInvoice {
  id: number;
  balance: DecimalLike;
  /** Oldest first: due date, then issue date, then id. */
  dueDate: string | null;
  issueDate: string | null;
}

export interface Allocation {
  invoiceId: number;
  amount: string;
}

/** Spreads a payment over open invoices, oldest first (BUILD_PLAN 8.7). The rest is credit. */
export function allocateOldestFirst(
  amount: DecimalLike,
  invoices: OpenInvoice[],
): { allocations: Allocation[]; unallocated: string } {
  let left = cents(amount);
  const key = (i: OpenInvoice) => `${i.dueDate ?? '9999'}|${i.issueDate ?? '9999'}`;
  const sorted = [...invoices].sort((a, b) => key(a).localeCompare(key(b)) || a.id - b.id);
  const allocations: Allocation[] = [];
  for (const inv of sorted) {
    if (left <= 0n) break;
    const balance = cents(inv.balance);
    if (balance <= 0n) continue;
    const take = balance < left ? balance : left;
    allocations.push({ invoiceId: inv.id, amount: dollars(take) });
    left -= take;
  }
  return { allocations, unallocated: dollars(left) };
}

/**
 * Checks hand-entered allocations: each within the invoice's balance, the sum within the
 * payment. Returns a plain-sentence problem, or null.
 */
export function checkAllocations(
  amount: DecimalLike,
  allocations: Allocation[],
  balances: Map<number, DecimalLike>,
): string | null {
  let sum = 0n;
  const seen = new Set<number>();
  for (const a of allocations) {
    if (seen.has(a.invoiceId)) return 'Each invoice can appear once in a payment.';
    seen.add(a.invoiceId);
    const balance = balances.get(a.invoiceId);
    if (balance === undefined) return "One of the invoices isn't open for this client.";
    const c = cents(a.amount);
    if (c <= 0n) return 'Allocated amounts must be more than zero.';
    if (c > cents(balance))
      return `That's more than the invoice's balance of $${dollars(cents(balance))}.`;
    sum += c;
  }
  if (sum > cents(amount)) return 'The allocations add up to more than the payment.';
  return null;
}

export interface TemplateLine {
  kind: InvoiceLineKind;
  amount: DecimalLike;
  homestead?: boolean;
  underArbitration?: boolean;
}

/**
 * The layout an invoice gets by default: zero savings when nothing is contingency, arbitration
 * when any property went to arbitration, homestead when every property is a homestead.
 */
export function chooseTemplate(lines: TemplateLine[]): InvoiceTemplate {
  const fees = lines.filter((l) => l.kind !== 'ADJUSTMENT');
  if (fees.length && !fees.some((l) => l.kind === 'CONTINGENCY' && cents(l.amount) > 0n))
    return 'ZERO_SAVINGS';
  if (fees.some((l) => l.underArbitration)) return 'ARBITRATION';
  if (fees.length && fees.every((l) => l.homestead)) return 'HOMESTEAD';
  return 'STANDARD';
}

/** INV-0042 from prefix "INV-" and sequence 42. */
export const formatInvoiceNumber = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(4, '0')}`;

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Sum of amounts as dollars ("1234.50"). */
export const sumMoney = (values: DecimalLike[]) =>
  dollars(values.reduce<bigint>((s, v) => s + cents(v), 0n));
