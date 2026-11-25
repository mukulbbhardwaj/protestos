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
3. generates the Prisma client and applies migrations
4. starts the API (http://localhost:3001), the worker, and the web app (http://localhost:5173)

The web dev server proxies `/api/*` to the API so the browser sees a single origin.

## Layout

```
apps/
  api/       Fastify HTTP API (zod type provider, pino logs, Sentry)
  worker/    pg-boss job runner
  web/       React 18 + Vite + Tailwind
packages/
  shared/    product config, roles, zod schemas, (later) fee engine and formatters
  db/        Prisma schema, migrations, client factory, (M1) org-scoped data layer
docs/
  BUILD_PLAN.md   decisions/
```

`packages/pdf` and `packages/providers` arrive in the milestones that need them.

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

- **Tenant isolation.** Route code may not import the raw Prisma client
  (`@app/db/raw`, `@prisma/client`, generated client). ESLint fails the build.
  The org-scoped layer, Postgres RLS and isolation tests arrive in M1.
- **No secrets in git.** `.env*` is ignored except `.env.example`; gitleaks runs
  on every commit (lefthook) and in CI.
- **Exact versions.** `.npmrc` sets `save-exact=true`.
