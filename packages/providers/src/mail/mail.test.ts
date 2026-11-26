import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DevFileMailProvider,
  MemoryMailProvider,
  parseMailEvents,
  signMailWebhook,
  verifyMailWebhook,
} from '../index.js';

const message = { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', orgId: null };

describe('MemoryMailProvider', () => {
  it('records messages', async () => {
    const mail = new MemoryMailProvider();
    await mail.send(message);
    expect(mail.lastTo('a@example.com')?.subject).toBe('Hi');
    expect(mail.lastTo('b@example.com')).toBeUndefined();
  });
});

describe('DevFileMailProvider', () => {
  it('writes messages to disk and lists newest first', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'mail-')), 'box');
    const mail = new DevFileMailProvider(dir);
    expect(await mail.list()).toEqual([]);
    await mail.send({ ...message, subject: 'first' });
    await mail.send({ ...message, subject: 'second' });
    const listed = await mail.list();
    expect(listed.map((m) => m.subject)).toEqual(['second', 'first']);
  });
});

describe('mock mail webhook', () => {
  it('verifies signatures and keeps only well-formed events', () => {
    const body = JSON.stringify({ events: [] });
    const sig = signMailWebhook('secret', body);
    expect(verifyMailWebhook('secret', body, sig)).toBe(true);
    expect(verifyMailWebhook('other', body, sig)).toBe(false);
    expect(verifyMailWebhook('secret', body, undefined)).toBe(false);
    expect(verifyMailWebhook('secret', body, 'short')).toBe(false);
    expect(
      parseMailEvents({
        events: [
          {
            id: 'e1',
            type: 'bounced',
            providerMessageId: 'm1',
            at: '2026-01-01T00:00:00Z',
            detail: 'mailbox full',
          },
          { id: 'e2', type: 'opened', providerMessageId: 'm1' },
          { id: 'e3', type: 'exploded', providerMessageId: 'm1' },
          { type: 'opened' },
        ],
      }).map((e) => `${e.id} ${e.type} ${e.detail ?? ''}`.trim()),
    ).toEqual(['e1 bounced mailbox full', 'e2 opened']);
    expect(parseMailEvents(null)).toEqual([]);
  });
});
