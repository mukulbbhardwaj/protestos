import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG, roleAtLeast } from './index.js';
import { loadRootEnv, resolveRequestId } from './node.js';

describe('roleAtLeast', () => {
  it('orders roles OWNER > ADMIN > STAFF > READ_ONLY', () => {
    expect(roleAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(roleAtLeast('ADMIN', 'ADMIN')).toBe(true);
    expect(roleAtLeast('STAFF', 'ADMIN')).toBe(false);
    expect(roleAtLeast('READ_ONLY', 'STAFF')).toBe(false);
  });
});

describe('APP_CONFIG', () => {
  it('keeps the product name in one place', () => {
    expect(APP_CONFIG.name).toBeTypeOf('string');
  });
});

describe('resolveRequestId', () => {
  it('keeps a well-formed incoming id', () => {
    expect(resolveRequestId('abc-12345')).toBe('abc-12345');
    expect(resolveRequestId(['abc-12345', 'other'])).toBe('abc-12345');
  });
  it('replaces missing or unsafe ids', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(undefined)).toMatch(uuid);
    expect(resolveRequestId('short')).toMatch(uuid);
    expect(resolveRequestId('bad id\nwith newline')).toMatch(uuid);
  });
});

describe('loadRootEnv', () => {
  it('finds .env at the workspace root and does not override existing vars', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'LOAD_ROOT_ENV_A=from-file\nLOAD_ROOT_ENV_B=from-file\n');
    process.env.LOAD_ROOT_ENV_B = 'preset';

    expect(loadRootEnv(nested)).toBe(join(root, '.env'));
    expect(process.env.LOAD_ROOT_ENV_A).toBe('from-file');
    expect(process.env.LOAD_ROOT_ENV_B).toBe('preset');
  });

  it('returns undefined when the root has no .env, or there is no workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    expect(loadRootEnv(root)).toBeUndefined();
    expect(loadRootEnv('/')).toBeUndefined();
  });
});
