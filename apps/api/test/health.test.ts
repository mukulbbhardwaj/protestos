import { pingDatabase } from '@app/db';
import { createPrismaClient } from '@app/db/raw';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

describe('GET /health', () => {
  it('returns 503 and db=down when the database is unreachable', async () => {
    const app = await buildApp({ pingDatabase: async () => false, version: 'test' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down', version: 'test' });
    await app.close();
  });

  it('echoes a safe incoming request id and generates one otherwise', async () => {
    const app = await buildApp({ pingDatabase: async () => true, version: 'test' });
    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-abc-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('req-abc-123');

    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  describe('against the real database', () => {
    const env = loadEnv();
    const prisma = createPrismaClient(env.DATABASE_URL);
    afterAll(() => prisma.$disconnect());

    it('returns 200 and db=ok', async () => {
      const app = await buildApp({ pingDatabase: () => pingDatabase(prisma), version: 'test' });
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
      await app.close();
    });
  });
});
