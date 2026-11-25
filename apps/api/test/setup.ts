import { loadRootEnv } from '@app/shared/node';

// Integration tests run against TEST_DATABASE_URL, never the dev database.
loadRootEnv();
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env (pnpm dev does this).');
}
process.env.DATABASE_URL = testUrl;
