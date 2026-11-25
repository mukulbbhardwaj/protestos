import { randomUUID } from 'node:crypto';
import type { MailMessage, MailProvider, SentMail } from './types.js';

/** Keeps messages in memory. For tests. */
export class MemoryMailProvider implements MailProvider {
  readonly name = 'memory';
  readonly sent: (MailMessage & { id: string })[] = [];

  async send(message: MailMessage): Promise<SentMail> {
    const id = randomUUID();
    this.sent.push({ ...message, id });
    return { providerMessageId: id };
  }

  /** Most recent message to `to`, if any. */
  lastTo(to: string): (MailMessage & { id: string }) | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}
