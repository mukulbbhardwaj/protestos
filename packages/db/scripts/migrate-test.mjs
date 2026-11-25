// Applies migrations to the integration-test database (TEST_DATABASE_URL).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set.');
  process.exit(1);
}
execSync('prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
