import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load the monorepo root .env when present; real env vars win (CI, production).
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` doesn't connect, so it may run without DATABASE_URL (e.g. on install).
    url: process.env.DATABASE_URL ?? '',
  },
});
