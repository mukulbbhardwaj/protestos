import { cents, dollars } from './index.js';

// Finance dashboard periods (BUILD_PLAN 8.10). Billed counts by issue date, collected by the
// payment's received date; all ranges are inclusive calendar days (YYYY-MM-DD).

export interface DayRange {
  from: string;
  to: string;
}

const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** This month to date, last month, year to date and last calendar year, as of a day. */
export function financePeriods(
  asOf: string,
): Record<'thisMonth' | 'lastMonth' | 'ytd' | 'lastYear', DayRange> {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  return {
    thisMonth: { from: iso(y, m - 1, 1), to: asOf },
    lastMonth: { from: iso(y, m - 2, 1), to: iso(y, m - 1, 0) },
    ytd: { from: iso(y, 0, 1), to: asOf },
    lastYear: { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) },
  };
}

/** The n months ending with asOf's month, oldest first: ["2025-12", …, "2026-11"]. */
export function monthsEnding(asOf: string, n: number): string[] {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => iso(y, m - n + i, 1).slice(0, 7));
}

export const inRange = (day: string | null, r: DayRange) =>
  day !== null && day >= r.from && day <= r.to;

/** Collected ÷ billed as a percentage with one decimal ("72.5"), or null when nothing was billed. */
export function collectionRate(billed: string, collected: string): string | null {
  const b = cents(billed);
  if (b <= 0n) return null;
  const tenths = (cents(collected) * 1000n + b / 2n) / b;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** Adds money strings. */
export const addMoney = (a: string, b: string) => dollars(cents(a) + cents(b));
