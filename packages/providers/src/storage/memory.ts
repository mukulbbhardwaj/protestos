import { assertSafeKey, StorageNotFoundError, type StorageProvider } from './types.js';

/** In-memory storage for tests. */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = 'memory';
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer | string, contentType: string) {
    assertSafeKey(key);
    this.files.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string) {
    const file = this.files.get(key);
    if (!file) throw new StorageNotFoundError(key);
    return file.body;
  }

  async delete(key: string) {
    this.files.delete(key);
  }
}
