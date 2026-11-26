# Progress

Plan: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). One milestone at a time; each ends with
this file updated, a commit on a feature branch, and a summary for Mukul.

| Milestone                                | Status                    |
| ---------------------------------------- | ------------------------- |
| M0 Repo foundation                       | ✅ Done (awaiting review) |
| M1 Auth, orgs and tenancy                | ✅ Done                   |
| M2 Contacts, properties, tax years       | ✅ Done                   |
| M2.5 Tax savings calculator              | ✅ Done (awaiting review) |
| M3 CSV import                            | ✅ Done (awaiting review) |
| M4 Invoicing and payments                | ✅ Done (awaiting review) |
| M5 Email and delivery tracking           | ✅ Done (awaiting review) |
| M6 Documents and e-signature             | ✅ Done (awaiting review) |
| M7 Hearings and dashboards               | ✅ Done (awaiting review) |
| M8 Public lead form                      | Not started               |
| M9 SaaS billing, onboarding, super-admin | Not started               |
| M10 Hardening and pilot readiness        | Not started               |

---

## M7: Hearings and dashboards (2026-11-26)

ADR 011.

### Done

- **Hearings:** week, month and list views (Central time), filters by status, county and
  consultant; schedule from the Hearings page or a property; edit status (attended,
  rescheduled, cancelled, no show), type, location, panel, consultant, notes. Scheduling moves
  the property-year to "Hearing scheduled".
- **CAD schedule import** (fourth import type): county, account, date, time, type, location,
  panel, consultant; re-importing an updated schedule reschedules.
- **Calendar feed:** "Subscribe" gives each member a private iCal link of their hearings for
  Google or Outlook, with "Make a new link".
- **Ops dashboard:** hearings this week (and today), documents waiting for signature; bounce
  alert and stage funnel from earlier milestones.
- **Finance dashboard** (owners and admins): billed and collected this month, last month,
  YTD and last year; collection rate; outstanding by days late; value reduced and tax saved
  for the tax year; billed vs collected by month (chart or table); billed by county; protest
  outcomes by year; largest balances; recent payments. Filters: date range, tax year,
  county, consultant, property type, payment method. Every table exports to CSV.
- **Demo data:** `pnpm db:backfill sample` now adds invoices, payments and hearings for the
  demo firms (≈2,300 invoices, 1,900 payments, 930 hearings).

### Verified

- **M7 "done when"** (`apps/api/test/finance.test.ts`): a fixture of 7 invoices and 4 payments
  with every dashboard number calculated by hand in the test (periods, collection rate,
  aging, by client, by county, monthly, savings, outcomes, filters).
- Hearings: stage move, filters, edit/delete with audit, CAD import (DST times, idempotent,
  reschedule), calendar feed and rotation, dashboard counts, roles; isolation for the new
  routes. Playwright: schedule from a property → calendar list; finance dashboard.
- 425 unit/integration tests and 14 Playwright tests; lint, typecheck, build. Looked at the
  finance dashboard and calendar in the browser with the demo data.

---

## M6: Documents and e-signature (2026-11-26)

ADR 010. E-signature provider: mock for now (Mukul, 2026-11-26).

### Done

- **Send documents** from a client or prospect (Documents tab): engagement agreement and/or
  Form 50-162, choose properties, tax year and signer; preview each PDF; one email with one
  link to sign everything. Prospects move to "Docs sent".
- **Form 50-162** filled from the firm (agent name, title, TDLR #, address, phone) and the
  owner, one per appraisal district with all of that owner's accounts there.
- **Signing page** (`/sign/:token`, no login): read each PDF, type name, agree, sign; or
  decline with a reason. Signed copies get a signature line on every page and a certificate.
- **After signing:** documents and request marked signed, signed PDFs on file, 50-162
  property-years → AOA signed (stage history), prospect → Signed. Dashboard checklist ticks
  "Connect e-signature".
- **Manage:** reminders, cancel (void) with a reason, copy signing link, "Upload signed" for
  paper signatures, and a Documents page across the firm (waiting, signed, declined,
  cancelled).
- **Settings → Documents:** agreement wording editor with placeholders and a PDF preview
  (versioned), Form 50-162 agent details, "allow sending signed documents again".

### Verified

- **M6 "done when"** (`apps/api/test/documents.test.ts`, mock provider in place of the DocuSign
  sandbox): a prospect gets an agreement and a 50-162 per county, opens the link, signs, the
  signed PDFs are stored and served, property-years are AOA signed and the prospect is SIGNED.
  Playwright (`e2e/documents.spec.ts`) does the same through the UI with the agreement.
- Also: 50-162 fields filled from firm and client, missing form explained, resend guard,
  reminders, void, decline, paper upload, own-properties check, roles, template versions, and
  isolation for the 12 new routes.

### Open

- **Add the official Form 50-162 PDF** (`packages/pdf/assets/README.md`) and check the field
  names in `FIELD_MAP` against it. Needs your OK to download it, or drop it in yourself.

---

## M5: Email and delivery tracking (2026-11-26)

ADR 009. Provider: mock for now (Mukul, 2026-11-26); Postmark or Brevo plugs into `MailProvider`.

### Done

- **Templates** (Settings → Emails, admins): invoice, invoice with no reduction, payment
  receipt, document reminder, prospect outreach. Plain text with placeholders, click to insert,
  live preview with sample values, typos caught on save, "Use built-in" to reset.
- **Send invoices** one at a time (invoice page) or in bulk (select rows on Invoices). The
  dialog previews each recipient (billing email, else email) and lists what won't be sent
  (drafts, no email, imported). Zero-savings invoices get the no-reduction email. PDF attached.
- **Queue and idempotency:** one `EmailDelivery` per email, sent by the worker with retries;
  the same send request never sends twice.
- **Tracking:** signed webhook updates each email to delivered / opened / bounced; the invoice
  shows its emails and their events, the list has an Email column and filter (not emailed,
  emailed, bounced), and the dashboard shows a bounce alert.
- **Payment receipts:** "Email the client a receipt" when recording a payment.
- Dev mailbox: shows attachments and can mark an email delivered, opened or bounced.

### Verified

- **M5 "done when"** (`apps/api/test/email.test.ts`): 50 invoices bulk-sent, 50 emails each
  tracked through delivered/opened/bounced via signed webhooks, the bounce shows on the
  invoice list filter, invoice detail and dashboard; the same request sent again sends
  nothing new; replayed events change nothing; unsigned webhooks get 401.
- Also: skipped reasons, zero-savings template, provider failure → FAILED with the error,
  receipt wording, template validation/preview/reset, roles. Isolation for the 5 new routes.
- Clicked through with the worker running: email sent to the dev mailbox with the PDF,
  bounce marked, dashboard alert shown.
- 363 unit/integration tests and 10 Playwright tests; lint, typecheck, build.

---

## M4: Invoicing and payments (2026-11-26)

ADR 008.

### Done

- **Generate:** pick a tax year (and county or consultant) → preview of the drafts with totals
  and the property-years skipped, with the reason (missing tax rate, no fee due) → drafts.
  Grouping is a firm setting: per client per year (default) or per property. A client's
  Billing tab can draft just their invoice ("Invoice 2026").
- **Review:** adjustment lines (negative for discounts), remove lines, layout (standard,
  arbitration, homestead, zero savings; chosen automatically), notes, live PDF preview.
- **Issue:** fees recalculated from current values and frozen with a snapshot, next number,
  issue and due dates (firm's payment terms), PDF stored, property-years → INVOICED.
- **Payments:** record against a client (Zelle, check, ACH, cash, card, other, reference),
  allocated oldest first or by hand; overpayment kept as credit and applied later. Partial
  and full payment derive invoice status; fully paid → property-years PAID. Delete a payment
  to reopen its invoices.
- **Void / write off** with a reason (audited); voiding returns payments to credit and makes
  the property-years billable again.
- **PDFs** (`packages/pdf`): invoice with one block per property and the fee working (notice →
  final, reduction × tax rate = savings × %), totals and payment instructions; client
  statement with open invoices, recent payments, credit and balance due.
- **Client Billing tab:** balance due, past due, credit, every invoice, statement PDF.
- **Historical invoices import** (third import type): balances and payments from the old
  system, idempotent on invoice number.
- Settings: invoice grouping, payment instructions.

### Verified

- **M4 "done when":** `apps/api/test/billing.test.ts` and `apps/web/e2e/invoicing.spec.ts`:
  generate → issue → part pay → pay in full, balances correct at each step, and changing the
  values, fee % and firm default after issue leaves the invoice, its lines and its PDF
  byte-for-byte unchanged.
- Billing rules in `packages/shared/src/billing` at 100% coverage (allocation, derived status,
  past due, aging, layout choice).
- 346 unit/integration tests (api 213 incl. isolation for all 17 billing routes; shared 102;
  db 11; web 8; providers 6; pdf 4; worker 2) and 9 Playwright tests; lint, typecheck, build.

---

## M3: CSV import (2026-11-26)

ADR 007.

### Done

- **Pipeline:** upload (raw CSV, 20 MB / 50,000 rows) → automatic column mapping (header
  synonyms from real firm exports; the firm's corrected mapping is remembered per import type)
  → dry run → confirm → background job (pg-boss, worker `imports.run`) → summary.
- **Import types:** Clients & properties, and Tax-year values. Historical invoices wait for
  invoicing (M4).
- **Matching and idempotency:** clients by client number, then email, then the property's
  owner; properties by county + account (punctuation-insensitive); tax years by property +
  year. Blank cells never erase values; changed fields are listed per row; stage changes are
  written to the stage history; new clients get the firm's next client number.
- **Normalizers** (100% coverage): county account formats, E.164 phones, dates (MM/DD/YYYY,
  M/D/YY, ISO, "Apr 15, 2026", Excel serials), money, percentages, yes/no, "City, ST ZIP".
  Hand-entered properties now use the same account rules.
- **Errors:** per-row messages in plain sentences; bad rows are skipped, good rows saved;
  "Error rows" downloads the original rows plus an "Import error" column, ready to fix and
  re-upload.
- **Storage** (`StorageProvider`: dev folder, memory for tests) and **job queue** interfaces.
- **Web:** Imports page (choose type, sample files, upload, history) and an import page
  (map columns with sample values → dry run tiles and rows by result → import, with live
  progress).
- Audit: `import.uploaded`, `import.started`, `import.completed` (with counts).

### Verified

- **M3 "done when":** a 5,000-row file imports (5,000 created), importing it again makes zero
  changes (5,000 unchanged), and error rows download as CSV — all in `apps/api/test/imports.test.ts`.
- 285 unit/integration tests (api 168 incl. isolation for all 9 import routes; shared 91;
  db 11; web 7; providers 6; worker 2) and 8 Playwright tests; lint, typecheck, format, build.
- Clicked through in the browser with the worker running: upload → auto-map → dry run →
  import → finished, with the bad row skipped.

### Decisions for later milestones (Mukul, 2026-11-26)

- **M4:** invoice grouping is a firm setting; default one invoice per client per tax year.
- **M5:** build behind `MailProvider` with the dev/log providers; choose Postmark or Brevo later.
- **M6:** build e-signature behind `SignatureProvider` with a mock; choose the provider later.
- **M9:** plans, trial and limits configurable (per-property and per-seat); placeholder prices
  in Stripe test mode.

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
