# 007: One import engine for dry run and import; storage and jobs behind interfaces

Status: accepted (M3)

## Decision

- **`packages/imports`** holds the import engine. The API runs it in `preview` mode for the
  dry run; the worker runs the same code in `apply` mode for the import. The only difference
  between the modes is whether writes happen, so the dry run is a faithful forecast and a
  re-import of the same file reports every row UNCHANGED.
- **Rows are matched, never duplicated:** clients on client number, then email, then (only
  when the row has neither) the owner of the row's property; properties on county + account
  number compared without punctuation; tax years on property + year. Blank cells never erase
  stored values. An account that belongs to another client is an error, checked before any
  write.
- **Per-row outcomes** live in `ImportRow` (not a JSON blob), so results page and filter, and
  the error file is rebuilt from the stored upload plus the ERROR rows.
- **`StorageProvider`** (`packages/providers`): `DevFileStorageProvider` in development (a
  folder shared by API and worker, `STORAGE_DIR`), `MemoryStorageProvider` in tests. Keys are
  `org/{orgId}/…`. S3-compatible storage is a later adapter (M6/M10).
- **`JobQueue`** (`apps/api/src/jobs.ts`): pg-boss in production, `InlineQueue` in tests (it
  runs the worker's handler in-process, so API tests cover the whole flow).
- **Normalizers** (`packages/shared/src/normalize`) are pure and 100% covered: account numbers
  per county (Harris 13 digits, Tarrant 8, Dallas 17: dashes dropped, leading zeros restored),
  phones to E.164, dates in common spreadsheet formats, money, percentages (a bare fraction
  like 0.3 is read as 30% with a warning), yes/no. Hand-entered properties use the same
  account rules.

## Why

- A separate preview implementation would drift from the real import; one engine can't.
- Interfaces keep tests fast and providers swappable (BUILD_PLAN 4).

## Consequences

- The worker must run for imports to complete (`pnpm dev` starts it).
- Historical invoice imports are reserved in the schema (`ImportKind.HISTORICAL_INVOICES`)
  and arrive with M4.
