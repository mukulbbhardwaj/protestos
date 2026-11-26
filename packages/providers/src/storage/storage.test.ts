import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DevFileStorageProvider } from './dev-file.js';
import { MemoryStorageProvider } from './memory.js';
import { StorageNotFoundError } from './types.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe.each([
  ['memory', async () => new MemoryStorageProvider()],
  [
    'dev-file',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'storage-'));
      dirs.push(dir);
      return new DevFileStorageProvider(dir);
    },
  ],
])('%s storage', (_name, make) => {
  it('stores, reads back and deletes', async () => {
    const s = await make();
    await s.put('org/1/imports/a.csv', 'a,b\n1,2\n', 'text/csv');
    expect((await s.get('org/1/imports/a.csv')).toString()).toBe('a,b\n1,2\n');
    await s.delete('org/1/imports/a.csv');
    await expect(s.get('org/1/imports/a.csv')).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('refuses keys that could escape the root', async () => {
    const s = await make();
    for (const key of ['../x', '/etc/passwd', 'org//x', '']) {
      await expect(s.put(key, 'x', 'text/plain')).rejects.toThrow(/Unsafe storage key/);
    }
  });
});
