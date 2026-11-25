# 006: CAD appraisal rolls as shared reference data, loaded from public bulk files

Status: accepted (M2.5)

## Decision

- The savings calculator works from the appraisal district's **published bulk roll files**
  (HCAD first: `https://download.hcad.org/data/CAMA/<year>/`), never from scraping CAD websites.
- The roll lives in platform tables (`CadParcel`, `CadTaxUnit`, `CadLoad`) with **no `orgId`**:
  every firm sees the same public roll. Like `County`, the tenant role can only read them
  (writes are revoked in the migration, and `forOrg` refuses writes in code).
- Loading is a backfill step (ADR 005), run by hand per county and year:
  `pnpm db:backfill cad --county harris --year 2026`. It replaces the whole county-year in
  one transaction, so re-running is safe and readers never see a half-loaded roll.
- Only residential single-family accounts (state class A1) are loaded in M2.5. That is what
  the estimate supports, and it keeps the table to about 1.2M rows for Harris.
- `cad-sample` loads a small **synthetic** Harris roll (accounts starting `999`) for
  development, demos and CI, which can't download hundreds of megabytes. It never overwrites a
  real load, and a real load replaces it.
- The estimate method is unequal appraisal (Tax Code §42.26(a)(3)), because it needs only
  public roll data. Sales-based estimates would need MLS or vendor data (Texas doesn't publish
  sale prices) and are out of scope.

## Why

- Public bulk files are the CAD's own data, free, complete, and allowed to be imported.
  Scraping is fragile and was already out of scope.
- One shared copy instead of one per firm: the data is identical for everyone, and firms'
  private data (fee terms, which accounts are their clients) stays in tenant tables.

## Consequences

- A firm's estimate reads the shared roll plus its own fee terms and properties through
  `forOrg`; the API never links an account to another firm's property (isolation-tested).
- Adding a county means writing an adapter for its file layout. Account-number formats differ
  by county; the roll stores them the way the CAD publishes them.
- Prisma migrations: the pg_trgm indexes are now declared in `schema.prisma`
  (`type: Gin, ops: raw("gin_trgm_ops")`). Before this, `migrate dev` generated drops for the
  hand-written M2 search indexes; declaring them stops that.
