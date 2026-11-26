import type { OrgDb } from '@app/db';
import {
  importFields,
  normalizeAccountNumber,
  normalizeEmail,
  normalizePhone,
  parseBoolean,
  parseDate,
  parseMoney,
  parsePercent,
  parseYear,
  splitCityStateZip,
  type ImportAction,
  type ImportField,
  type ImportKind,
  type ImportSummary,
  type Parsed,
} from '@app/shared';

export interface ImportContext {
  db: OrgDb;
  orgId: number;
  actorUserId: number | null;
}

export interface ImportInput {
  kind: ImportKind;
  /** header → field key (null = ignored). */
  mapping: Record<string, string | null>;
  headers: string[];
  /** Data rows (no header). */
  rows: string[][];
}

export interface RowResult {
  /** 1-based data row number. */
  rowNumber: number;
  action: ImportAction;
  label: string | null;
  changes: string[];
  messages: string[];
}

export interface ImportOutcome {
  rows: RowResult[];
  summary: ImportSummary;
}

export type Mode = 'preview' | 'apply';

/** Cells for one row, by field key; only mapped, non-blank cells are present. */
export type RowValues = Map<string, string>;

export function rowValues(input: ImportInput): RowValues[] {
  const columns = input.headers
    .map((h, i) => ({ i, key: input.mapping[h] ?? null }))
    .filter((c): c is { i: number; key: string } => c.key !== null);
  return input.rows.map((cells) => {
    const values: RowValues = new Map();
    for (const { i, key } of columns) {
      const v = (cells[i] ?? '').trim();
      if (v !== '') values.set(key, v);
    }
    return values;
  });
}

export function summarize(rows: RowResult[]): ImportSummary {
  const summary: ImportSummary = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0 };
  for (const r of rows) summary[r.action] += 1;
  return summary;
}

/** Strongest action wins: a row that creates anything is a CREATE. */
export function combine(...actions: (ImportAction | null)[]): ImportAction {
  if (actions.includes('CREATE')) return 'CREATE';
  if (actions.includes('UPDATE')) return 'UPDATE';
  return 'UNCHANGED';
}

/** Account numbers compared without punctuation or case, so "066-064-013" matches "066064013". */
export const accountKey = (countyId: number, account: string) =>
  `${countyId}:${account.toUpperCase().replace(/[^0-9A-Z]/g, '')}`;

export interface CountyRef {
  id: number;
  name: string;
}

/** "Harris", "HARRIS COUNTY", "Harris CAD", "harris county appraisal district" → Harris. */
export async function countyLookup(db: OrgDb) {
  const counties = await db.county.findMany({
    where: { state: 'TX' },
    select: { id: true, name: true },
  });
  const byName = new Map(counties.map((c) => [c.name.toLowerCase(), c]));
  return (raw: string): CountyRef | null => {
    const key = raw
      .trim()
      .toLowerCase()
      .replace(/\b(central appraisal district|appraisal district|county|cad)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return byName.get(key) ?? null;
  };
}

/** Parses one field's raw text by its declared type. County, account and choices are parsed by the caller. */
export function parseField(field: ImportField, raw: string): Parsed<unknown> {
  switch (field.type) {
    case 'email':
      return normalizeEmail(raw);
    case 'phone':
      return normalizePhone(raw);
    case 'money':
      return parseMoney(raw);
    case 'percent':
      return parsePercent(raw);
    case 'date':
      return parseDate(raw);
    case 'boolean':
      return parseBoolean(raw);
    case 'year':
      return parseYear(raw);
    case 'cityStateZip':
      return splitCityStateZip(raw);
    default:
      return { ok: true, value: raw };
  }
}

/** Parses every mapped field in a row; returns values by key plus messages. */
export function parseRow(kind: ImportKind, values: RowValues) {
  const fields = new Map(importFields(kind).map((f) => [f.key, f]));
  const parsed = new Map<string, unknown>();
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [key, raw] of values) {
    const field = fields.get(key);
    if (!field) continue;
    const r = parseField(field, raw);
    if (r.ok) {
      parsed.set(key, r.value);
      if (r.warning) warnings.push(`${field.label}: ${r.warning}`);
    } else errors.push(`${field.label}: ${r.error}`);
  }
  return { parsed, errors, warnings };
}

export function parseAccount(raw: string, county: CountyRef): Parsed<string> {
  return normalizeAccountNumber(raw, county.name);
}

// ---------------------------------------------------------------------------
// Comparing a parsed value with what's stored (so a re-import changes nothing).

type Stored = { toString(): string } | string | number | boolean | Date | null | undefined;

export function sameValue(stored: Stored, next: unknown): boolean {
  if (stored === null || stored === undefined || stored === '') return next === null || next === '';
  if (stored instanceof Date) return stored.toISOString().slice(0, 10) === String(next);
  if (typeof stored === 'boolean') return stored === next;
  const a = stored.toString();
  const b = String(next);
  if (/^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b)) return Number(a) === Number(b);
  return a === b;
}

/** Writes rows' outcomes in chunks (5,000-row files stay one query per thousand). */
export async function saveRows(
  db: OrgDb,
  orgId: number,
  importJobId: number,
  phase: 'PREVIEW' | 'APPLY',
  rows: RowResult[],
) {
  await db.importRow.deleteMany({ where: { importJobId } });
  for (let i = 0; i < rows.length; i += 1000) {
    await db.importRow.createMany({
      data: rows.slice(i, i + 1000).map((r) => ({
        orgId,
        importJobId,
        phase,
        rowNumber: r.rowNumber,
        action: r.action,
        label: r.label,
        changes: r.changes,
        messages: r.messages,
      })),
    });
  }
}
