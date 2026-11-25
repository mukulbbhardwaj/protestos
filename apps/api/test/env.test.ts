import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x' });
    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.DEV_MAIL_DIR).toMatch(/\.dev-mail$/);
  });

  it('uses secure cookies when the app is served over https', () => {
    expect(loadEnv({ DATABASE_URL: 'x', APP_URL: 'https://app.example.com' }).COOKIE_SECURE).toBe(
      true,
    );
  });

  it('fails with a readable message when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
