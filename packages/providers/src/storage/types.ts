/**
 * File storage (BUILD_PLAN 4: S3-compatible behind an interface; keys under org/{orgId}/…).
 * Imports keep their uploaded CSV here; documents (M6) will too.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No stored file at ${key}`);
  }
}

/** Keys are relative paths; reject anything that could escape the storage root. */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
