# 001: Monorepo and core stack

Status: accepted (M0)

## Decision

- pnpm workspaces + Turborepo.
- **Fastify 5** (not Express) with `fastify-type-provider-zod`, so the zod schemas in
  `@app/shared` validate requests and serialise responses.
- Prisma 7 (stable) with the `@prisma/adapter-pg` driver adapter. Prisma 8 is still a release
  candidate.
- TypeScript **5.9**, not 7.0. typescript-eslint 8 supports TypeScript only below 6.1.
- React **18.3** as the plan says, although React 19 is current. Revisit after v1.
- pg-boss 12 for jobs (Postgres only, no Redis).
- Integer ids (`autoincrement`). The RLS policy in plan 6.3 compares against
  `current_setting(...)::int`.
- Prisma default naming (PascalCase tables, camelCase columns). RLS SQL quotes `"orgId"`.

## Consequences

- Changing the HTTP framework later would be costly. All route code assumes Fastify plugins.
- Bumping TypeScript to 7 waits for typescript-eslint support.
