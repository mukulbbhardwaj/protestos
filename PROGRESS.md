# Progress

Plan: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). One milestone at a time; each ends with
this file updated, a commit on a feature branch, and a summary for Mukul.

| Milestone                                | Status                    |
| ---------------------------------------- | ------------------------- |
| M0 Repo foundation                       | ✅ Done (awaiting review) |
| M1 Auth, orgs and tenancy                | ✅ Done                   |
| M2 Contacts, properties, tax years       | ✅ Done                   |
| M2.5 Tax savings calculator              | ✅ Done (awaiting review) |
| M3 CSV import                            | Not started               |
| M4 Invoicing and payments                | Not started               |
| M5 Email and delivery tracking           | Not started               |
| M6 Documents and e-signature             | Not started               |
| M7 Hearings and dashboards               | Not started               |
| M8 Public lead form                      | Not started               |
| M9 SaaS billing, onboarding, super-admin | Not started               |
| M10 Hardening and pilot readiness        | Not started               |

---

## M2.5: Tax savings calculator (2026-11-26)

Spec: [`docs/specs/savings-calculator.md`](docs/specs/savings-calculator.md). ADR 006.

### Done

- **Estimate engine** (`packages/shared/src/estimate`): Texas §42.26 unequal-appraisal estimate.
  Comparable selection (strict and wide passes), land/size adjustment, median, homestead and
  circuit-breaker caps, per-unit tax savings with percentage exemptions and the over-65 school
  ceiling, fee and "client keeps". Commercial rules (spec 5a): building area, same building
  type, neighborhood then market area. **100% coverage, enforced.**
- **CAD roll data** (platform reference tables `CadParcel`, `CadTaxUnit`, `CadLoad`; tenant
  role read-only). `pnpm db:backfill cad --county <c> --year 2026` replaces a county-year in one
  transaction. Adapters: Harris (HCAD files), Travis/Denton/Montgomery (Legacy 8.0 export, one
  parser), Collin (Texas Open Data Portal), Fort Bend and Williamson (Orion). `cad-sample` is a
  synthetic Harris roll for dev and CI.
- **Loaded locally (2026):** Harris 1,226,427 (incl. 68,797 commercial), Collin 364,455,
  Fort Bend 280,394, Denton 278,731, Montgomery 232,479 (incl. 10,699 commercial),
  Williamson 207,851. Values hand-checked against HCAD's source rows.
- **Tax rates:** Harris (HCAD rate file), Collin (CAD entity list), Montgomery and Williamson
  (county tax offices), Fort Bend (county worksheet, downloaded by hand). Files in
  `packages/db/src/reference/cad-rates/`.
- **Equity index** per parcel (improvement $/sq ft ÷ neighborhood median) for the
  "over-assessed" filter.
- **API:** coverage, search, browse with filters, facets, estimate, create prospect from a
  parcel; isolation tests for each. Platform admin: `/admin/data/*` (super-admins only).
- **Web:** Calculator page (Browse & filter, Search, estimate with comparables and per-unit
  savings, create prospect), estimate card on the property page, Platform data page.
- Trigram indexes are now declared in `schema.prisma` (Prisma had generated drops for them).
- Select dropdowns use an inset chevron app-wide.

### Verified

- 220 unit/integration tests (shared 58, api 140, db 11, web 7, providers 2, worker 2) and
  7 Playwright tests; lint, typecheck and format green.
- Real Harris data: estimate p95 25 ms; browse sorted by equity 0.2 s; filtered 0.4–1.4 s.

### Not done / known gaps

- **Denton rates** (tax-roll download kept failing), **Travis** (Cloudflare blocks the
  export; needs a manual download), **Dallas/Tarrant** (unreachable from this machine),
  **Bexar** (no bulk download; open-records request).
- Montgomery and Fort Bend are missing many MUD rates; estimates warn when a unit has no rate.
- Collin publishes no over-65 data, so the school freeze isn't applied there (warned).
- Denton commercial is left out: its export doesn't name building types.
- Equity index outliers (tiny or unusual buildings) are capped at 0.1–10× but still surface
  at the top of the default sort.

### Decisions / assumptions to confirm

1. HCAD's rate file has `curr` and `prop` columns; we use `curr`, else `prop`. Confirm against
   a real 2026 tax bill.
2. The demo owner (`owner@demo.test`) is a super-admin in development, for the Platform page.
3. Florida research (`reports/Florida entry and competitor landscape.md`, not committed):
   recommends Florida only after counsel confirms who may be paid to represent owners.

---

## M2: Contacts, properties and tax years (2026-11-25)

### Done

- **Schema:** Contact (prospects + clients), Property, County (reference), TaxYearRecord,
  ProtestStageEvent. Composite foreign keys (`orgId`, id) make cross-firm links impossible at the
  database level. RLS on every new tenant table; stage history and County are write-protected
  for the tenant role. Trigram indexes for search.
- **Backfill scripts (ADR 005):** `pnpm db:backfill counties|demo|sample|all [--reset]`. All 254
  Texas counties; realistic sample data for both demo firms (Lone Star: 900 clients,
  120 prospects, ~2,400 properties in 7 counties; Gulf Coast: 260 clients, 45 prospects,
  ~650 properties), 2024–2026 values with homestead caps, and stage history.
- **Fee engine** (`packages/shared/src/fees`): exact BigInt decimal maths, contingency/flat/BPP
  resolution chain (tax year → property → client → firm), appraised or market basis,
  current-year-only flat fee, fraction-rate warning, explanation lines. **100% coverage,
  enforced in CI.**
- **API:** contacts (list/search/filter/sort/paginate, prospect counts, create with client
  number, update, convert, archive cascade, restore), properties (list with year/stage/county/
  type/consultant filters, create, update, archive/restore, detail with fee context and stage
  history), tax years (create, update, stage change), bulk assign consultant / set stage /
  roll over, global search, counties, dashboard stats. Every change is audited.
- **Web:** Clients and Prospects lists (filters in the URL, status tabs), client detail
  (overview form with fee terms, properties, activity), Properties list with multi-select bulk
  actions, property detail with a tax-year selector, value editor (formatted money inputs,
  change column), **live fee preview** from the shared engine, stage control and per-year
  history. Cmd/Ctrl+K search. Dashboard with real counts and a stage breakdown.
- **Settings:** savings basis (appraised/market), current tax year, flat fee current-year-only.
- **Landing page** at `/` for logged-out visitors (always light theme).
- Wider content area (96rem) for wide screens.

### Verified

- 165 unit/integration tests (api 110 incl. isolation cases for all 32 tenant routes;
  shared 33; db 11; web 7; providers 2; worker 2) and 5 Playwright tests (including create
  client → add property → enter values → fee preview shows $258.00 → save).
- lint, typecheck, format, build green. Screenshots checked at 1440 and 2000px, light and dark.

### M2 acceptance criteria

- Create a client with 3 properties, enter notice and final values, see a correct fee
  preview: ✅ (e2e covers one property; the API tests cover several).
- Fee engine coverage is 100%: ✅ (enforced threshold).

### Not done yet (remaining M2 / plan section 11 polish)

- CSV/XLSX export of lists, column picker, "select all matching the filter" for bulk actions
  (bulk works on selected rows only).
- Prospect kanban view (plan puts it in M8).
- Client statement PDF (needs invoices, M4).
- Search performance has not been measured at 50k rows (M10 perf pass).

### Decisions / assumptions to confirm

1. **BPP fee** applies to a tax year only when that year has a rendition date or its own BPP
   fee (from the reference app's per-year "BPP invoice"). It then resolves tax year →
   property → client → firm.
2. Converting a prospect sets status SIGNED and keeps the original `convertedAt` if one exists.
3. Account numbers are stored trimmed, without spaces, upper-case. County-specific formatting
   (dashes) is kept as entered; M3's import normalizers will handle per-county rules.

---

## M1: Auth, orgs and tenancy (2026-11-25)

### Done

- **Auth (in-house, ADR 004):** sign up, email verification, log in/out, forgot/reset password,
  resend verification. scrypt passwords, hashed session tokens in httpOnly SameSite=Lax cookies,
  rate limits on auth endpoints, Origin check on writes.
- **Orgs:** create a firm (verified email required; creator becomes OWNER; 14-day trial
  placeholder), unique slugs, reserved words blocked.
- **Team:** invitations (email + role, 7-day single-use link, resend, revoke, accept by the
  invited email only), role changes, remove/restore access. Owners-only rules for owners;
  no self-edits.
- **Roles:** STAFF and READ_ONLY get 403 on settings, finance, invitations and the audit log.
  READ_ONLY can't make any change. Guards run before body validation.
- **Tenant isolation (ADR 003):** `forOrg` data layer, Postgres RLS via an `app_tenant` role,
  and the isolation harness covering every `/orgs/:orgSlug` route.
- **Audit log:** org creation, settings changes (field-level before/after diff), membership
  and invitation changes. Append-only at the database level.
- **Settings API + page:** firm profile, address, phone, website, timezone, brand color, fee
  defaults, invoice prefix/next number/due days.
- **Finance stub:** `GET /finance/summary` (ADMIN+) so role gating is real now; figures arrive
  in M4/M7.
- **`packages/providers`:** `MailProvider` interface, `MemoryMailProvider` (tests) and
  `DevFileMailProvider` (local) with a **dev mailbox** page at `/dev/mailbox`.
- **Web app:** shadcn-style UI (Radix + Tailwind tokens), light/dark/system theme, sidebar
  with every module (role-gated, milestone badges), org switcher, user menu, Cmd/Ctrl+K search
  placeholder, dashboard with onboarding checklist and trial banner, settings (General, Team,
  Audit log), finance page, "coming soon" pages describing each later module, auth pages,
  onboarding, invitation acceptance. Usable at tablet width (drawer sidebar).
- **Demo seed** (`pnpm db:seed`, run by `pnpm dev`): two firms and users in every role.
  Password `demo-password`.

### Verified locally

- 92 unit/integration tests: api 57 (auth, orgs, roles, invitations, isolation), db 11 (forOrg,
  RLS, table registry), shared 13, web 7, providers 2, worker 2.
- 3 Playwright tests: owner dashboard + org switch + settings save + audit; staff blocked from
  finance/settings; sign-up → confirm email via dev mailbox → create firm → invite.
- lint, typecheck, format, build all green.

### M1 acceptance criteria

- Two orgs created through the UI cannot see each other's data: ✅ (isolation harness + RLS tests).
- A STAFF user gets 403 on the finance and settings APIs: ✅ (`orgs.test.ts`, plus the UI hides them).
- Isolation tests pass: ✅

### Deferred / notes

- Production `MailProvider` is not configured; the API refuses to start with
  `NODE_ENV=production` until M5 adds Postmark or Brevo.
- Logo upload waits for file storage (S3/R2 interface), first needed for PDFs in M4.
- A change and its audit row are written in separate transactions (see ADR 003).
- No super-admin UI yet (M9). `User.isSuperAdmin` exists but grants nothing so far.
- Seat limits are not enforced on invitations yet (M9).
- Session cleanup: expired sessions are deleted when used; a periodic sweep job can join the
  worker later.

### Open questions for Mukul

1. Hosting and email provider (from M0): still open; email is needed by M5.
2. A user who belongs to several firms lands on the firm they joined first, then the last one
   they opened. OK?
3. The dev "demo accounts" box shows only in local development builds. Do you also want a
   demo firm on staging for sales calls? (Not built.)

---

## M0: Repo foundation (2026-11-25)

### Done

- pnpm workspaces + Turborepo: `apps/{api,worker,web}`, `packages/{shared,db}`.
- TypeScript 5.9 strict everywhere (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- ESLint 10 flat config (typescript-eslint, react-hooks) with a **raw-DB import ban** for app
  code, Prettier, EditorConfig.
- Vitest in every package; Playwright smoke test (`apps/web/e2e/smoke.spec.ts`).
- docker-compose Postgres 16 (port 54329) with an `app_test` database; `pg_trgm` enabled by
  migration so managed databases get it too.
- `packages/db`: Prisma 7 schema for Org, User, Membership, AuditLog (all Org fields from
  plan 5.1), initial migrations, `createPrismaClient` (raw, infra-only) and `pingDatabase`.
- API: Fastify 5 + zod type provider, pino JSON logs with redaction, request ids (honours a
  safe incoming `x-request-id`, echoes it in the response and logs), optional Sentry,
  `GET /health` (200 / 503 with db status).
- Worker: pg-boss 12 with a job registry and a `system.heartbeat` cron job.
- Web: React 18 + Vite 8 + Tailwind 4, dark mode follows the OS, optional Sentry, API health
  indicator. Dev proxy `/api → :3001` (same origin, so session cookies just work in M1).
- Sentry data policy shared across api/worker/web: no cookies, bodies, query strings or user
  info (`packages/shared/src/sentry.ts`).
- Secrets: `.env.example`, `.gitignore`, gitleaks pre-commit hook via lefthook (local binary,
  Docker fallback) and a CI job scanning full history.
- GitHub Actions: secret scan; format, lint, typecheck, test, build against a Postgres
  service; Playwright e2e job.
- `pnpm dev` bootstraps a clean machine (creates `.env`, starts Postgres, migrates).

### Verified locally

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (15 tests), `pnpm build`, `pnpm test:e2e`: all green.
- `pnpm dev` starts api, worker and web; `/api/health` through the web proxy returns `ok`.
- Compiled API (`node dist/server.js`) serves `/health` and logs JSON with `requestId`.
- The ESLint ban fires on `import ... from '@app/db/raw'` inside `apps/api/src/routes`.
- `gitleaks` finds nothing in the repo.

### Not verified

- CI has not run yet: there is no GitHub remote. Push the branch to see it go green.

### Deferred / notes for later milestones

- `User` has no password fields yet. M1 picks the auth library (Better Auth vs in-house
  sessions) and shapes the auth tables to fit it.
- `AuditLog.orgId` is required. Platform-level (super-admin) audit events may need a nullable
  org or a separate table in M9.
- API integration tests currently use `DATABASE_URL`; M1 switches them to
  `TEST_DATABASE_URL` before tests start truncating tables.
- Plan typos noticed: section 3 item 4 reads "Proper, type, assigned consultant)" (assumed
  "Properties (CAD account, county, type, assigned consultant)"); `invoiceDueDa` implemented
  as `invoiceDueDays`.

### Open questions for Mukul

1. **Hosting** (plan 13.1): Vercel or Cloudflare Pages for web; Fly.io or Render for
   api/worker; Neon or Supabase for Postgres. Needed by M10, and earlier if you want a
   staging URL. Note: web and API must share a registrable domain (e.g. `app.x.com` +
   `api.x.com`) or sit behind one origin, so SameSite=Lax session cookies work.
2. **Email provider** (plan 13.1): Postmark or Brevo. Needed by M5.
3. **Product name and domain**: any time.

### Proposed (outside v1 scope; not built)

- None yet.
