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
