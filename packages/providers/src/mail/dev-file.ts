import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailMessage, MailProvider, SentMail } from './types.js';

export interface StoredMail extends MailMessage {
  id: string;
  sentAt: string;
}

/**
 * Local development only: writes each email to a JSON file so the dev mailbox
 * page can show it. Nothing leaves the machine.
 */
export class DevFileMailProvider implements MailProvider {
  readonly name = 'dev-file';
  private seq = 0;

  constructor(private readonly dir: string) {}

  async send(message: MailMessage): Promise<SentMail> {
    await mkdir(this.dir, { recursive: true });
    const id = randomUUID();
    const sentAt = new Date().toISOString();
    const stored: StoredMail = { ...message, id, sentAt };
    // Sortable file name: timestamp, then a per-process sequence for same-millisecond sends.
    const name = `${Date.now()}-${String(this.seq++).padStart(6, '0')}-${id}.json`;
    await writeFile(join(this.dir, name), JSON.stringify(stored, null, 2));
    return { providerMessageId: id };
  }

  async list(limit = 50): Promise<StoredMail[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const recent = files
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);
    return Promise.all(
      recent.map(async (f) => JSON.parse(await readFile(join(this.dir, f), 'utf8')) as StoredMail),
    );
  }
}
