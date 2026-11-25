import { existsSync } from 'node:fs';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set.');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
