import type { MailMessage, MailProvider, SentMail } from './types.js';

/**
 * Writes each email to the log instead of sending it. For staging and test servers until a real
 * provider lands (M5): links such as email verification appear in the server log. Never for a
 * real pilot, since anyone with log access can read them.
 */
export class LogMailProvider implements MailProvider {
  readonly name = 'log';
  private sequence = 0;

  constructor(
    private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  async send(message: MailMessage): Promise<SentMail> {
    const providerMessageId = `log-${Date.now()}-${++this.sequence}`;
    this.write(
      JSON.stringify({
        msg: 'mail (log provider, not sent)',
        providerMessageId,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    );
    return { providerMessageId };
  }
}
