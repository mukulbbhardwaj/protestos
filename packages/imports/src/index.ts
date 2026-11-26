import type { OrgDb } from '@app/db';
import type { StorageProvider } from '@app/providers';
import { parseCsv } from '@app/shared';
import {
  saveRows,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type Mode,
} from './common.js';
import { importContacts } from './contacts.js';
import { importInvoices } from './invoices.js';
import { importTaxYears } from './tax-years.js';

export type { ImportContext, ImportOutcome, RowResult } from './common.js';

/** Files larger than this are refused at upload (BUILD_PLAN M3 targets 5,000 rows). */
export const MAX_IMPORT_ROWS = 50_000;

export class ImportFileError extends Error {}

/** Splits an uploaded CSV into its header row and data rows. */
export function readCsv(text: string): { headers: string[]; rows: string[][] } {
  const all = parseCsv(text);
  const [headerRow, ...rows] = all;
  const headers = (headerRow ?? []).map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => !h)) {
    throw new ImportFileError('The file is empty, or its first row has no column names.');
  }
  const seen = new Set<string>();
  for (const h of headers) {
    if (h && seen.has(h))
      throw new ImportFileError(`Two columns are both called "${h}". Rename one and upload again.`);
    seen.add(h);
  }
  if (rows.length === 0) throw new ImportFileError('The file has column names but no rows.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      `The file has ${rows.length.toLocaleString()} rows; split it into files of ${MAX_IMPORT_ROWS.toLocaleString()} or fewer.`,
    );
  }
  return { headers, rows };
}

async function run(ctx: ImportContext, input: ImportInput, mode: Mode): Promise<ImportOutcome> {
  switch (input.kind) {
    case 'CONTACTS_PROPERTIES':
      return importContacts(ctx, input, mode);
    case 'TAX_YEAR_VALUES':
      return importTaxYears(ctx, input, mode);
    case 'HISTORICAL_INVOICES':
      return importInvoices(ctx, input, mode);
  }
}

async function loadJob(db: OrgDb, storage: StorageProvider, jobId: number) {
  const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
  const { headers, rows } = readCsv((await storage.get(job.fileKey)).toString('utf8'));
  const input: ImportInput = {
    kind: job.kind,
    mapping: job.columnMapping as Record<string, string | null>,
    headers,
    rows,
  };
  return { job, input };
}

/** Dry run: what each row would do, with nothing written except the results themselves. */
export async function previewImport(ctx: ImportContext, storage: StorageProvider, jobId: number) {
  const { input } = await loadJob(ctx.db, storage, jobId);
  const outcome = await run(ctx, input, 'preview');
  await saveRows(ctx.db, ctx.orgId, jobId, 'PREVIEW', outcome.rows);
  await ctx.db.importJob.update({
    where: { id: jobId },
    data: { status: 'PREVIEWED', summary: outcome.summary, previewedAt: new Date(), error: null },
  });
  return outcome;
}

/**
 * The real import (run by the worker). Rows that fail are reported and skipped; the rest are
 * saved. Running the same file again changes nothing (every row comes back UNCHANGED).
 */
export async function applyImport(ctx: ImportContext, storage: StorageProvider, jobId: number) {
  await ctx.db.importJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null },
  });
  try {
    const { job, input } = await loadJob(ctx.db, storage, jobId);
    const outcome = await run(ctx, input, 'apply');
    await saveRows(ctx.db, ctx.orgId, jobId, 'APPLY', outcome.rows);
    await ctx.db.importJob.update({
      where: { id: jobId },
      data: { status: 'DONE', summary: outcome.summary, finishedAt: new Date() },
    });
    await ctx.db.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorUserId: ctx.actorUserId,
        action: 'import.completed',
        entityType: 'ImportJob',
        entityId: String(jobId),
        after: { kind: job.kind, fileName: job.fileName, ...outcome.summary },
      },
    });
    return outcome;
  } catch (e) {
    await ctx.db.importJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error:
          e instanceof ImportFileError
            ? e.message
            : 'The import stopped unexpectedly. Rows saved before the error were kept; you can run it again safely.',
      },
    });
    throw e;
  }
}
