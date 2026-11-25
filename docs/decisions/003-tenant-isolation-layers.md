# 003: Tenant isolation in layers

Status: accepted (M0 groundwork; completed in M1)

## Decision

Isolation has three independent layers. Any one of them alone should stop a cross-org read.

1. **Data layer:** `@app/db` exposes only org-scoped access (`forOrg(orgId)`, M1). The raw
   client lives in `@app/db/raw`. ESLint bans importing it (or `@prisma/client`, or the
   generated client) from app code. Only process entry points (`apps/api/src/server.ts`,
   `apps/api/src/plugins/db.ts`), the worker, and tests are exempt.
2. **Postgres RLS (M1):** every tenant table gets a policy on
   `current_setting('app.current_org_id')`, set with `SET LOCAL` for each transaction. The app
   connects as a non-owner role so RLS applies. Super-admin tooling uses a separate role.
3. **Isolation tests (M1):** a shared harness seeds org A and org B and asserts that every
   tenant route in org A cannot read or change org B's rows.

## Consequences

- Every new table needs `orgId`, an RLS policy, and coverage in the isolation harness.
- The worker is exempt from the lint ban, so its handlers must scope by the job's `orgId`.
  M1 gives the worker the same `forOrg` helper.
