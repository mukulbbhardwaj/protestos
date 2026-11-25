# protest-os (working name)

Multi-tenant web app for Texas property tax consulting firms: prospects → signed
contracts and Form 50-162 → clients and properties → hearings → contingency
invoices → payments → owner reporting.

- Product plan: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)
- Status, deferred work and open questions: [`PROGRESS.md`](PROGRESS.md)
- Architecture decisions: [`docs/decisions/`](docs/decisions)

The product name is a placeholder. It lives in one place:
`packages/shared/src/config.ts` (`APP_CONFIG`).

## Requirements

- Node 22.12+ (`.nvmrc`)
- pnpm 10 (`corepack enable` picks up the pinned version)
- Docker Desktop (local Postgres 16)
- gitleaks for the pre-commit secret scan (`brew install gitleaks`), or Docker running

## Setup

```sh
pnpm i
pnpm dev
```

On first run `pnpm dev`:

1. creates `.env` from `.env.example`
2. starts Postgres in Docker (host port **54329**) and waits for it to be healthy
3. generates the Prisma client and applies migrations (dev and test databases)
4. loads demo data into an empty dev database
5. starts the API (http://localhost:3001), the worker, and the web app (http://localhost:5173)

### Demo logins (local only)

Open http://localhost:5173 and log in with password `demo-password`:

| Email              | Role                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `owner@demo.test`  | Owner of _Lone Star Demo_ and admin of _Gulf Coast Demo_ (shows the firm switcher) |
| `admin@demo.test`  | Admin                                                                              |
| `staff@demo.test`  | Staff (no finance or settings)                                                     |
| `viewer@demo.test` | Read only                                                                          |

Emails (verification, password reset, invitations) are not sent locally. They appear in the
**dev mailbox** at http://localhost:5173/dev/mailbox.

The web dev server proxies `/api/*` to the API so the browser sees a single origin.

## Layout

```
apps/
  api/       Fastify HTTP API (zod type provider, pino logs, Sentry)
  worker/    pg-boss job runner
  web/       React 18 + Vite + Tailwind
packages/
  shared/    product config, roles, zod schemas shared by web and api, password/token helpers
  db/        Prisma schema, migrations, forOrg tenant layer, demo seed
  providers/ MailProvider (dev file mailbox, in-memory for tests); later signature, storage, billing
docs/
  BUILD_PLAN.md   decisions/
```

`packages/pdf` arrives with invoices (M4).

Workspace packages export TypeScript source under the `development` export
condition (used by `tsx`, Vite, Vitest and `tsc`) and compiled `dist/` for
production. See ADR 002.

## Commands

| Command                                        | What it does                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Bootstrap (see above) and run api + worker + web                                |
| `pnpm test`                                    | Unit and integration tests (Vitest); needs Postgres up                          |
| `pnpm test:e2e`                                | Playwright; first run `pnpm --filter @app/web exec playwright install chromium` |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint, `tsc --noEmit`, Prettier                                                |
| `pnpm build`                                   | Production build of every package                                               |
| `pnpm db:up` / `pnpm db:down`                  | Start or stop local Postgres                                                    |
| `pnpm db:migrate`                              | Create and apply a new migration (`prisma migrate dev`)                         |
| `pnpm secrets:scan`                            | gitleaks scan of the working tree                                               |

## Rules that are enforced

- **Tenant isolation** (ADR 003). Tenant routes use only `request.tenant.db` (`forOrg`);
  ESLint bans the raw Prisma client in routes and the web app; Postgres RLS backs it up; and
  `apps/api/test/isolation.test.ts` fails if any `/orgs/:orgSlug` route lacks a cross-org test.
  New tenant table checklist: `orgId` column, `TENANT_MODELS` entry, RLS policy in the
  migration, isolation cases.
- **No secrets in git.** `.env*` is ignored except `.env.example`; gitleaks runs
  on every commit (lefthook) and in CI.
- **Exact versions.** `.npmrc` sets `save-exact=true`.
