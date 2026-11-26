// Normalizers for imported spreadsheet values (BUILD_PLAN 8.9). Pure: the same rules run in the
// API's dry run, the worker's import, and anywhere a person types an account number.

export type Parsed<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string };

const ok = <T>(value: T, warning?: string): Parsed<T> =>
  warning ? { ok: true, value, warning } : { ok: true, value };
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** Header text → a comparable key: "Client  #" and "client_no." both become "client". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:number|num|no)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Account numbers

interface CountyAccountRule {
  /** Strip everything but letters and digits (the CAD's own export has no punctuation). */
  compact: boolean;
  /** Left-pad all-digit accounts to this length (spreadsheets drop leading zeros). */
  padTo?: number;
  /** Expected length once compacted, if fixed. */
  length?: number;
}

/**
 * Per-county formats, from each CAD's own export (spec savings-calculator.md §4). Counties not
 * listed keep their punctuation (a dash can be meaningful) and only lose spaces.
 */
const COUNTY_ACCOUNT_RULES: Record<string, CountyAccountRule> = {
  harris: { compact: true, padTo: 13, length: 13 },
  tarrant: { compact: true, padTo: 8, length: 8 },
  dallas: { compact: true, length: 17 },
};

/**
 * Trims, upper-cases and removes spaces; for counties with a known format, also removes dashes
 * and restores leading zeros that a spreadsheet dropped. Leading zeros are never removed.
 */
export function normalizeAccountNumber(raw: string, countyName?: string | null): Parsed<string> {
  const text = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!text) return fail('Enter the CAD account number.');
  const rule = countyName ? COUNTY_ACCOUNT_RULES[countyName.trim().toLowerCase()] : undefined;
  if (!rule) return ok(text);
  let value = text.replace(/[^0-9A-Z]/g, '');
  let warning: string | undefined;
  if (rule.padTo && /^\d+$/.test(value) && value.length < rule.padTo) {
    value = value.padStart(rule.padTo, '0');
    warning = `Leading zeros restored: ${value}.`;
  }
  if (rule.length && value.length !== rule.length) {
    warning = `${countyName} account numbers are usually ${rule.length} characters; this one has ${value.length}.`;
  }
  return ok(value, warning);
}

// ---------------------------------------------------------------------------
// Contact details

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): Parsed<string> {
  const value = raw.trim().toLowerCase();
  return EMAIL.test(value) ? ok(value) : fail(`"${raw.trim()}" isn't a valid email address.`);
}

/** US numbers become E.164 (+12815551234); anything else is kept as written, with a warning. */
export function normalizePhone(raw: string): Parsed<string> {
  const text = raw.trim();
  const ext = /\s*(?:x|ext\.?)\s*\d+$/i.exec(text);
  const digits = (ext ? text.slice(0, ext.index) : text).replace(/\D/g, '');
  if (digits.length === 10) return ok(`+1${digits}`);
  if (digits.length === 11 && digits.startsWith('1')) return ok(`+${digits}`);
  return ok(text, `"${text}" doesn't look like a US phone number, so it was kept as written.`);
}

/** "HOUSTON, TX 77002-1234" / "Houston TX 77002" → parts. */
export function splitCityStateZip(
  raw: string,
): Parsed<{ city: string; state: string; zip: string }> {
  const m = /^\s*(.+?)[,\s]+([A-Za-z]{2})\.?[,\s]+(\d{5})(?:-?\d{4})?\s*$/.exec(raw);
  if (!m) return fail(`Couldn't read city, state and ZIP from "${raw.trim()}".`);
  return ok({ city: m[1]!.trim(), state: m[2]!.toUpperCase(), zip: m[3]! });
}

// ---------------------------------------------------------------------------
// Numbers, dates, yes/no

/** "$1,234.56" → "1234.56". Negative amounts are refused (values and fees are never negative). */
export function parseMoney(raw: string): Parsed<string> {
  const text = raw.trim();
  if (/^\(.*\)$/.test(text) || /^-|^\$-/.test(text)) {
    return fail(`"${text}" is negative; amounts here can't be.`);
  }
  const plain = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(plain))
    return fail(`"${text}" isn't an amount, like 1250 or $1,250.00.`);
  const [int, frac = ''] = plain.split('.') as [string, string?];
  if (frac.length > 2) return ok(Number(plain).toFixed(2), `"${text}" was rounded to the cent.`);
  return ok(frac ? `${int}.${frac}` : int);
}

/**
 * "30%", "30" → "30". A bare number below 1 is read as a fraction ("0.3" → "30") with a
 * warning, since contingency and tax rates are entered as percentages.
 */
export function parsePercent(raw: string, { allowFraction = true } = {}): Parsed<string> {
  const text = raw.trim();
  const hasSign = text.endsWith('%');
  const plain = text.replace(/[%\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(plain)) return fail(`"${text}" isn't a percentage, like 30 or 30%.`);
  const n = Number(plain);
  if (!hasSign && allowFraction && n > 0 && n < 1) {
    const pct = String(Math.round(n * 1e6) / 1e4);
    return ok(pct, `"${text}" was read as ${pct}%.`);
  }
  if (n > 100) return fail(`"${text}" is more than 100%.`);
  return ok(plain);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(y: number, m: number, d: number): Parsed<string> {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return fail(`${m}/${d}/${y} isn't a real date.`);
  }
  return ok(date.toISOString().slice(0, 10));
}

/**
 * Dates as firms' spreadsheets write them: 04/15/2026, 4/15/26, 2026-04-15, Apr 15 2026,
 * 15-Apr-2026, and Excel serial numbers (46127). Returns YYYY-MM-DD.
 */
export function parseDate(raw: string): Parsed<string> {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const y = Number(m[3]);
    // Two-digit years: 00–69 → 2000s, 70–99 → 1900s (spreadsheet convention).
    return isoDate(
      m[3]!.length === 2 ? (y < 70 ? 2000 + y : 1900 + y) : y,
      Number(m[1]),
      Number(m[2]),
    );
  }
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) {
    return isoDate(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2]));
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(text);
  if (m && MONTHS.includes(m[2]!.toLowerCase())) {
    return isoDate(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[1]));
  }
  if (/^\d{5}$/.test(text)) {
    // Excel's day count from 1899-12-30 (which absorbs its 1900 leap-year bug).
    const date = new Date(Date.UTC(1899, 11, 30) + Number(text) * 86_400_000);
    return ok(date.toISOString().slice(0, 10), `${text} was read as an Excel date.`);
  }
  return fail(`"${text}" isn't a date we can read. Use MM/DD/YYYY.`);
}

const TRUE = new Set(['y', 'yes', 'true', 't', '1', 'x']);
const FALSE = new Set(['n', 'no', 'false', 'f', '0']);

export function parseBoolean(raw: string): Parsed<boolean> {
  const text = raw.trim().toLowerCase();
  if (TRUE.has(text)) return ok(true);
  if (FALSE.has(text)) return ok(false);
  return fail(`"${raw.trim()}" isn't yes or no.`);
}

export function parseYear(raw: string): Parsed<number> {
  const text = raw.trim();
  const n = Number(text);
  if (!/^\d{4}$/.test(text) || n < 2000 || n > 2100) return fail(`"${text}" isn't a tax year.`);
  return ok(n);
}

/** Matches a value against allowed options by code or label, ignoring case and spacing. */
export function parseChoice<T extends string>(
  raw: string,
  options: readonly T[],
  aliases: Record<string, T> = {},
): Parsed<T> {
  const key = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const hit = options.find((o) => o === key) ?? aliases[key];
  if (hit) return ok(hit);
  return fail(
    `"${raw.trim()}" isn't one of: ${options.map((o) => o.toLowerCase().replace(/_/g, ' ')).join(', ')}.`,
  );
}

export { parseCsv, toCsvLine } from './csv.js';
