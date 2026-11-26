import { parseChoice, PROTEST_STAGES, SYSTEM_STAGES, type ProtestStage } from '@app/shared';
import {
  accountKey,
  countyLookup,
  parseAccount,
  parseRow,
  rowValues,
  sameValue,
  summarize,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type Mode,
  type RowResult,
} from './common.js';

// Tax-year values (BUILD_PLAN 8.9): match (county, account number, tax year) to the firm's
// property and its record for that year. The property must already exist.

const VALUE_FIELDS = [
  'noticeLand',
  'noticeImprovement',
  'noticeMarket',
  'noticeAppraised',
  'finalLand',
  'finalImprovement',
  'finalMarket',
  'finalAppraised',
  'taxRatePct',
  'homestead',
  'underLitigation',
  'underArbitration',
  'noticeReceivedAt',
  'protestFiledAt',
  'resultAt',
  'bppRenderedAt',
  'bppFee',
  'contingencyPctOverride',
  'notes',
] as const;
const DATE_FIELDS = new Set(['noticeReceivedAt', 'protestFiledAt', 'resultAt', 'bppRenderedAt']);

const LABELS: Record<string, string> = {
  noticeLand: 'notice land',
  noticeImprovement: 'notice improvement',
  noticeMarket: 'notice market',
  noticeAppraised: 'notice appraised',
  finalLand: 'final land',
  finalImprovement: 'final improvement',
  finalMarket: 'final market',
  finalAppraised: 'final appraised',
  taxRatePct: 'tax rate',
  homestead: 'homestead',
  underLitigation: 'litigation',
  underArbitration: 'arbitration',
  noticeReceivedAt: 'notice received',
  protestFiledAt: 'protest filed',
  resultType: 'result',
  resultAt: 'result date',
  bppRenderedAt: 'BPP rendition',
  bppFee: 'BPP fee',
  contingencyPctOverride: 'contingency %',
  notes: 'notes',
  protestStage: 'stage',
};

const MANUAL_STAGES = PROTEST_STAGES.filter((s) => !SYSTEM_STAGES.includes(s));
const STAGE_ALIASES: Record<string, ProtestStage> = {
  NEW: 'NOT_STARTED',
  AOA: 'AOA_SIGNED',
  NOTICE: 'NOTICE_RECEIVED',
  FILED: 'PROTEST_FILED',
  PROTESTED: 'PROTEST_FILED',
  HEARING: 'HEARING_SCHEDULED',
  SETTLEMENT: 'SETTLED',
  BOARD: 'BOARD_ORDER',
};
const RESULT_TYPES = ['SETTLEMENT', 'BOARD_ORDER', 'NO_CHANGE', 'WITHDRAWN'] as const;
const RESULT_ALIASES = { SETTLED: 'SETTLEMENT', BOARD: 'BOARD_ORDER', ARB: 'BOARD_ORDER' } as const;

type YearRecord = Record<string, unknown> & { id: number; protestStage: ProtestStage };

export async function importTaxYears(
  ctx: ImportContext,
  input: ImportInput,
  mode: Mode,
): Promise<ImportOutcome> {
  const { db, orgId, actorUserId } = ctx;
  const county = await countyLookup(db);
  const parsedRows = rowValues(input).map((values) => ({
    values,
    ...parseRow('TAX_YEAR_VALUES', values),
  }));

  const countyIds = [
    ...new Set(
      parsedRows
        .map((r) => (r.values.get('county') ? county(r.values.get('county')!)?.id : undefined))
        .filter((id): id is number => id !== undefined),
    ),
  ];
  const properties = new Map<string, { id: number; accountNumber: string }>();
  if (countyIds.length) {
    for (const p of await db.property.findMany({
      where: { countyId: { in: countyIds } },
      select: { id: true, countyId: true, accountNumber: true },
    })) {
      properties.set(accountKey(p.countyId, p.accountNumber), p);
    }
  }
  const years = [
    ...new Set(parsedRows.map((r) => r.parsed.get('taxYear') as number).filter(Boolean)),
  ];
  const records = new Map<string, YearRecord>();
  if (years.length && properties.size) {
    const ids = [...properties.values()].map((p) => p.id);
    for (let i = 0; i < ids.length; i += 1000) {
      for (const r of await db.taxYearRecord.findMany({
        where: { propertyId: { in: ids.slice(i, i + 1000) }, taxYear: { in: years } },
      })) {
        records.set(`${r.propertyId}:${r.taxYear}`, r as unknown as YearRecord);
      }
    }
  }

  let tempId = -1;
  const results: RowResult[] = [];
  for (const [i, row] of parsedRows.entries()) {
    const rowNumber = i + 1;
    const messages = [...row.errors, ...row.warnings];
    const label =
      [row.values.get('county'), row.values.get('accountNumber'), row.values.get('taxYear')]
        .filter(Boolean)
        .join(' ') || null;
    const fail = (message?: string) =>
      results.push({
        rowNumber,
        action: 'ERROR',
        label,
        changes: [],
        messages: message ? [message, ...messages] : messages,
      });
    if (row.errors.length) {
      fail();
      continue;
    }
    const missing = (['county', 'accountNumber', 'taxYear'] as const).filter(
      (k) => !row.values.has(k),
    );
    if (missing.length) {
      fail(
        `Missing ${missing.map((k) => ({ county: 'county', accountNumber: 'account number', taxYear: 'tax year' })[k]).join(', ')}.`,
      );
      continue;
    }
    const c = county(row.values.get('county')!);
    if (!c) {
      fail(`County: "${row.values.get('county')}" isn't a Texas county.`);
      continue;
    }
    const acct = parseAccount(row.values.get('accountNumber')!, c);
    if (!acct.ok) {
      fail(`CAD account number: ${acct.error}`);
      continue;
    }
    const property = properties.get(accountKey(c.id, acct.value));
    if (!property) {
      fail(
        `No property with account ${acct.value} in ${c.name} in your firm. Import it with "Clients & properties" first.`,
      );
      continue;
    }
    const taxYear = row.parsed.get('taxYear') as number;

    const stage = row.values.has('protestStage')
      ? parseChoice(row.values.get('protestStage')!, MANUAL_STAGES, STAGE_ALIASES)
      : null;
    const result = row.values.has('resultType')
      ? parseChoice(row.values.get('resultType')!, RESULT_TYPES, RESULT_ALIASES)
      : null;
    if (stage && !stage.ok) {
      fail(`Protest stage: ${stage.error} (Invoiced and paid are set by invoices and payments.)`);
      continue;
    }
    if (result && !result.ok) {
      fail(`Result: ${result.error}`);
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const k of VALUE_FIELDS) if (row.parsed.has(k)) patch[k] = row.parsed.get(k);
    if (result?.ok) patch.resultType = result.value;
    const toDb = (data: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          DATE_FIELDS.has(k) && v ? new Date(`${v}T00:00:00Z`) : v,
        ]),
      );

    const key = `${property.id}:${taxYear}`;
    const existing = records.get(key);
    const label2 = `${c.name} ${property.accountNumber} · ${taxYear}`;
    try {
      if (!existing) {
        const toStage = stage?.ok ? stage.value : 'NOT_STARTED';
        let id = tempId--;
        if (mode === 'apply') {
          const created = await db.taxYearRecord.create({
            data: {
              orgId,
              propertyId: property.id,
              taxYear,
              protestStage: toStage,
              ...toDb(patch),
            },
            select: { id: true },
          });
          id = created.id;
          await db.protestStageEvent.create({
            data: {
              orgId,
              taxYearRecordId: id,
              fromStage: null,
              toStage,
              note: 'Imported',
              actorUserId,
            },
          });
        }
        records.set(key, { id, protestStage: toStage, ...patch });
        results.push({ rowNumber, action: 'CREATE', label: label2, changes: [], messages });
        continue;
      }
      const update: Record<string, unknown> = {};
      const changes: string[] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (!sameValue(existing[k] as never, v)) {
          update[k] = v;
          changes.push(LABELS[k] ?? k);
        }
      }
      const stageChanged = stage?.ok && stage.value !== existing.protestStage;
      if (stageChanged) changes.push('stage');
      if (changes.length && mode === 'apply' && existing.id > 0) {
        await db.taxYearRecord.update({
          where: { id: existing.id },
          data: { ...toDb(update), ...(stageChanged ? { protestStage: stage.value } : {}) },
        });
        if (stageChanged) {
          await db.protestStageEvent.create({
            data: {
              orgId,
              taxYearRecordId: existing.id,
              fromStage: existing.protestStage,
              toStage: stage.value,
              note: 'Imported',
              actorUserId,
            },
          });
        }
      }
      Object.assign(existing, update, stageChanged ? { protestStage: stage.value } : {});
      results.push({
        rowNumber,
        action: changes.length ? 'UPDATE' : 'UNCHANGED',
        label: label2,
        changes,
        messages,
      });
    } catch (e) {
      fail(`Couldn't save the tax year: ${(e as Error).message.split('\n').at(-1)}`);
    }
  }
  return { rows: results, summary: summarize(results) };
}
