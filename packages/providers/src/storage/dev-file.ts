import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertSafeKey, StorageNotFoundError, type StorageProvider } from './types.js';

/** Local development: files under a folder on disk (shared by the API and the worker). */
export class DevFileStorageProvider implements StorageProvider {
  readonly name = 'dev-file';

  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer | string) {
    assertSafeKey(key);
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      return await readFile(join(this.root, key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
      throw e;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await rm(join(this.root, key), { force: true });
  }
}
