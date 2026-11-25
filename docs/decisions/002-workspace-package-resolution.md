# 002: How workspace packages are consumed

Status: accepted (M0)

## Context

Apps import `@app/shared` and `@app/db`. We want instant dev reloads without a build step,
and plain Node (no bundler) in production.

## Decision

Each package's `exports` has three conditions:

```json
".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }
```

- Dev and test tools opt into `development`: `tsx --conditions=development`, Vite/Vitest
  `resolve.conditions`, and `customConditions` in `tsconfig.base.json` for typechecking.
- Production runs `node dist/...`, which resolves the compiled `dist/`. Turbo's
  `build` depends on `^build`.
- Package source uses NodeNext ESM with explicit `.js` extensions on relative imports.
- The Prisma client is generated as ESM TypeScript into `packages/db/src/generated`
  (gitignored) and compiled with the package.

## Consequences

- Never import a package's `src/` by path; always use the package name.
- A new package must copy the same `exports` shape.
