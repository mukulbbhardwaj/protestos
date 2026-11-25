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
}

export interface SentMail {
  providerMessageId: string;
}

/** Postmark or Brevo implement this in M5 (BUILD_PLAN 13.1 is still open). */
export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<SentMail>;
}
