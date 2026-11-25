# 003: Tenant isolation in layers

Status: accepted (M0 groundwork, built in M1)

Isolation has three independent layers. Any one of them alone should stop a cross-org read.

## 1. Data layer: `forOrg(prisma, orgId)` (`packages/db/src/tenant.ts`)

- A Prisma client extension. Every query on a tenant model gets `orgId` injected into `where`
  (and forced on `create`/`upsert`, and stripped from `update` data so rows can't move orgs).
- `Org` is pinned to `id = orgId`. `User` is read-only. Platform models (`Session`,
  `AuthToken`) are refused.
- Tenant routes only ever see `request.tenant.db`, built after the membership check.
- ESLint bans importing the raw client (`@app/db/raw`, `@prisma/client`, the generated
  client) from app code. Only process wiring (`apps/api/src/server.ts`, `app.ts`), system
  services (`apps/api/src/services/**`: auth and onboarding, which by nature act before an org
  is chosen), the worker and tests are exempt.

## 2. Postgres RLS

- Migration `tenant_rls` creates a `NOLOGIN` role `app_tenant`, grants it to the connecting
  role, and enables a `tenant_isolation` policy on every table with `orgId` (plus `Org`, and
  `User` via membership).
- `forOrg` runs each query in a transaction that does `SET LOCAL ROLE app_tenant` and
  `set_config('app.current_org_id', ...)`. With no org set, the policies match nothing.
- `app_tenant` can't touch `Session`/`AuthToken`, can't create or delete orgs or users, and
  can't update or delete `AuditLog` (append-only).
- System code runs as the connecting role (the table owner), so RLS doesn't block auth or
  onboarding. We chose `SET ROLE` over a second login role so there is a single
  `DATABASE_URL`; on managed Postgres the owner role needs `CREATEROLE` once, for the migration.

## 3. Tests

- `apps/api/test/isolation.test.ts`: org A's owner calls every `/orgs/:orgSlug` route with
  org B's slug, and every `:id` route with org B's ids under their own slug. Each must return
  404, leak nothing, and leave org B's rows unchanged. A meta-test fails if a tenant route
  has no case.
- `packages/db/test/tenant.test.ts`: forOrg filtering, raw SQL under `app_tenant`, and a check
  that every table with an `orgId` column is listed in `TENANT_MODELS` and has RLS and a
  policy.

## Consequences

- Every new tenant table needs: `orgId`, an entry in `TENANT_MODELS`, an RLS policy in its
  migration, and isolation cases for its routes. The tests above fail if any is missing.
- Each `forOrg` query costs a small transaction (3 statements). Revisit in M10 if list pages
  miss the 500ms p95 target.
- Multi-step writes are not yet atomic (a change and its audit row are two transactions).
  Add an interactive `withOrgTransaction` when M2's archive cascade needs it.
