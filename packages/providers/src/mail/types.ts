export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Org the email is sent for; null for platform mail (verification, password reset). */
  orgId: number | null;
  /** Lets a provider drop duplicates (e.g. a retried job). */
  idempotencyKey?: string;
  tag?: string;
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface SentMail {
  providerMessageId: string;
}

/**
 * Sends one email. Postmark or Brevo will implement this (BUILD_PLAN 13.1 is still open); until
 * then dev-file and memory are used, and delivery events arrive through the mock webhook format
 * in webhook.ts.
 */
export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<SentMail>;
}

/** A delivery event from a provider webhook, normalized. */
export interface MailEvent {
  /** Provider's event id: processing the same id twice changes nothing. */
  id: string;
  type: 'delivered' | 'opened' | 'bounced' | 'complained';
  providerMessageId: string;
  at: string;
  detail?: string;
}
