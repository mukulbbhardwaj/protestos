import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MailEvent } from './types.js';

// The mock provider's webhook format, used in development and tests until a real provider is
// chosen (BUILD_PLAN 13.1). Body: { events: MailEvent[] }. Header `x-mail-signature`:
// "sha256=" + hex HMAC-SHA256 of the raw body with the shared secret.

export const MAIL_SIGNATURE_HEADER = 'x-mail-signature';

export function signMailWebhook(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyMailWebhook(
  secret: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signMailWebhook(secret, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const TYPES = new Set(['delivered', 'opened', 'bounced', 'complained']);

/** Keeps well-formed events only; anything else in the payload is ignored. */
export function parseMailEvents(body: unknown): MailEvent[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((e): MailEvent[] => {
    const r = e as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.providerMessageId !== 'string' ||
      typeof r.type !== 'string' ||
      !TYPES.has(r.type)
    )
      return [];
    return [
      {
        id: r.id,
        type: r.type as MailEvent['type'],
        providerMessageId: r.providerMessageId,
        at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
        ...(typeof r.detail === 'string' ? { detail: r.detail.slice(0, 500) } : {}),
      },
    ];
  });
}
