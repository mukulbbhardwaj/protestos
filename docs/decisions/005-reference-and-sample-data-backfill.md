# 005: Reference and sample data via backfill scripts, not migrations

Status: accepted (M2)

## Decision

Migrations hold only schema: tables, constraints, indexes, RLS policies and grants.
Data is loaded by an idempotent backfill command, `pnpm db:backfill <step>`
(`packages/db/scripts/backfill/`):

| Step       | What                                                                                  | Where it may run                                 |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `counties` | The 254 Texas counties and their appraisal districts (`src/reference/tx-counties.ts`) | Every environment, including production          |
| `demo`     | Two demo firms and users in every role                                                | Development only (refuses `NODE_ENV=production`) |
| `sample`   | About 1,300 clients and prospects, about 3,000 properties, 3 tax years, stage history | Development only                                 |
| `all`      | All of the above, in order                                                            |                                                  |

Each step adds only what is missing, so re-running is safe. `--reset` deletes and regenerates
the demo firms' sample data. The sample generator uses a seeded PRNG, so the same firm always
gets the same data.

## Why

- Reference data changes (a CAD renames, a website moves) can be re-applied without a new
  migration, and fixes reach every environment by re-running the backfill.
- Demo and sample data must never ship as a migration, or it would reach production.

## Consequences

- A new environment needs `pnpm db:backfill counties` after `migrate deploy`. `pnpm dev`
  and CI do this automatically; production deploys must include it (docs/ops.md in M10).
