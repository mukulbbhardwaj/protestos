import { z } from 'zod';
import { IMPORT_KINDS } from '../imports/fields.js';

// CSV import API (BUILD_PLAN 8.9).

export const IMPORT_STATUSES = ['UPLOADED', 'PREVIEWED', 'RUNNING', 'DONE', 'FAILED'] as const;
export const IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const ImportSummary = z.object({
  CREATE: z.number(),
  UPDATE: z.number(),
  UNCHANGED: z.number(),
  ERROR: z.number(),
});
export type ImportSummary = z.infer<typeof ImportSummary>;

export const ImportJobDto = z.object({
  id: z.number(),
  kind: z.enum(IMPORT_KINDS),
  status: z.enum(IMPORT_STATUSES),
  fileName: z.string(),
  rowCount: z.number(),
  headers: z.array(z.string()),
  /** header → field key (null = ignored). */
  columnMapping: z.record(z.string(), z.string().nullable()),
  /** First rows, for the mapping screen. */
  sample: z.array(z.array(z.string())),
  summary: ImportSummary.nullable(),
  /** Which phase `summary` and the rows describe. */
  phase: z.enum(['PREVIEW', 'APPLY']).nullable(),
  error: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  previewedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type ImportJobDto = z.infer<typeof ImportJobDto>;

export const ImportListItem = ImportJobDto.omit({
  headers: true,
  columnMapping: true,
  sample: true,
});
export type ImportListItem = z.infer<typeof ImportListItem>;

export const ImportUploadQuery = z.object({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().trim().min(1).max(200),
});

export const UpdateMappingInput = z.object({
  columnMapping: z.record(z.string(), z.string().nullable()),
  /** Remember this mapping for the firm's next file of the same type. */
  remember: z.boolean().default(true),
});

export const ImportRowsQuery = z.object({
  action: z.enum(IMPORT_ACTIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const ImportRowDto = z.object({
  rowNumber: z.number(),
  action: z.enum(IMPORT_ACTIONS),
  label: z.string().nullable(),
  changes: z.array(z.string()),
  messages: z.array(z.string()),
});
export type ImportRowDto = z.infer<typeof ImportRowDto>;
