import { randomUUID } from 'node:crypto';
import type { MailMessage, MailProvider, SentMail } from './types.js';

/** Keeps messages in memory. For tests. */
export class MemoryMailProvider implements MailProvider {
  readonly name = 'memory';
  readonly sent: (MailMessage & { id: string })[] = [];
  /** Addresses the "provider" refuses, to test failures. */
  readonly refuse = new Set<string>();

  async send(message: MailMessage): Promise<SentMail> {
    if (this.refuse.has(message.to)) throw new Error(`Provider refused ${message.to}`);
    const id = randomUUID();
    this.sent.push({ ...message, id });
    return { providerMessageId: id };
  }

  /** Most recent message to `to`, if any. */
  lastTo(to: string): (MailMessage & { id: string }) | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}
