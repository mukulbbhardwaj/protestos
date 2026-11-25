import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DevFileMailProvider, MemoryMailProvider } from '../index.js';

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
