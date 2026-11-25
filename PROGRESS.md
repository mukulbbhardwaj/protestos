# Progress

Plan: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). One milestone at a time; each ends with
this file updated, a commit on a feature branch, and a summary for Mukul.

| Milestone                                | Status                    |
| ---------------------------------------- | ------------------------- |
| M0 Repo foundation                       | ✅ Done (awaiting review) |
| M1 Auth, orgs and tenancy                | Not started               |
| M2 Contacts, properties, tax years       | Not started               |
| M3 CSV import                            | Not started               |
| M4 Invoicing and payments                | Not started               |
| M5 Email and delivery tracking           | Not started               |
| M6 Documents and e-signature             | Not started               |
| M7 Hearings and dashboards               | Not started               |
| M8 Public lead form                      | Not started               |
| M9 SaaS billing, onboarding, super-admin | Not started               |
| M10 Hardening and pilot readiness        | Not started               |

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
