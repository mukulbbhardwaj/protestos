import { existsSync } from 'node:fs';
import { createPrismaClient, type PrismaClient } from '../../src/raw.js';

const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export function connect(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  return createPrismaClient(url);
}

export function assertNotProduction(what: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to load ${what} in production.`);
  }
}

export function log(message: string) {
  console.log(`[backfill] ${message}`);
}
