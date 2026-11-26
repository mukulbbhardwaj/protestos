import { MAIL_SIGNATURE_HEADER, signMailWebhook } from '@app/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_MAIL_WEBHOOK_SECRET } from '../src/app.js';
import {
  addMember,
  createUser,
  login,
  makeTestApp,
  ownerWithOrg,
  resetDb,
  type TestContext,
} from './helpers.js';

// M5 "done when": a bulk send to 50 clients finishes, each is tracked, a bounce shows, and
// sending the same request twice doesn't send twice.

let t: TestContext;
let cookie: string;
let slug: string;
let orgId: number;
let countyId: number;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDb();
  t.mail.sent.length = 0;
  t.mail.refuse.clear();
  const o = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
  cookie = o.cookie;
  slug = o.org.slug;
  orgId = o.org.id;
  countyId = (
    await t.prisma.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  await req('PATCH', '/settings', {
    defaultContingencyPct: '30',
    taxYearDefault: 2026,
    invoicePrefix: 'INV-',
    paymentInstructions: 'Zelle billing@example.com',
  });
});

const req = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  payload?: object,
  c = cookie,
) =>
  t.app.inject({
    method,
    url: `/orgs/${slug}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

/** n clients, each with one billable 2026 property-year; returns the issued invoice ids. */
async function issuedInvoices(n: number, opts: { email?: (i: number) => string | null } = {}) {
  for (let i = 0; i < n; i++) {
    const c = await t.prisma.contact.create({
      data: {
        orgId,
        kind: 'CLIENT',
        clientNumber: String(2000 + i),
        displayName: `Client ${i}`,
        email: opts.email ? opts.email(i) : `client${i}@example.com`,
      },
    });
    const p = await t.prisma.property.create({
      data: { orgId, contactId: c.id, countyId, accountNumber: `ACCT${i}` },
    });
    await t.prisma.taxYearRecord.create({
      data: {
        orgId,
        propertyId: p.id,
        taxYear: 2026,
        noticeAppraised: '500000',
        finalAppraised: '450000',
        taxRatePct: '2',
      },
    });
  }
  const ids = (await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })).json()
    .createdIds as number[];
  for (const id of ids)
    expect((await req('POST', `/invoices/${id}/issue`, {})).statusCode).toBe(200);
  return ids;
}

function webhook(events: object[], secret = DEV_MAIL_WEBHOOK_SECRET) {
  const body = JSON.stringify({ events });
  return t.app.inject({
    method: 'POST',
    url: '/webhooks/mail',
    headers: {
      'content-type': 'application/json',
      [MAIL_SIGNATURE_HEADER]: signMailWebhook(secret, body),
    },
    payload: body,
  });
}

describe('sending invoices', () => {
  it('bulk-sends 50, tracks each, shows a bounce, and never sends a request twice', async () => {
    const ids = await issuedInvoices(50);
    expect(ids).toHaveLength(50);

    const dry = (
      await req('POST', '/invoices/send', { invoiceIds: ids, requestKey: 'req-0001', dryRun: true })
    ).json();
    expect(dry.queued).toHaveLength(50);
    expect(t.mail.sent).toHaveLength(0);

    const res = await req('POST', '/invoices/send', { invoiceIds: ids, requestKey: 'bulk-0001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ repeated: false, skipped: [] });
    expect(t.mail.sent).toHaveLength(50);
    const first = t.mail.sent.find((m) => m.to === 'client0@example.com')!;
    expect(first.subject).toMatch(/^Invoice INV-\d{4} from Firm$/);
    expect(first.text).toContain('Zelle billing@example.com');
    expect(first.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(first.attachments?.[0]?.filename).toMatch(/^Invoice INV-\d{4}\.pdf$/);
    expect(first.attachments?.[0]?.content.subarray(0, 5).toString()).toBe('%PDF-');

    // The same request again (a double click, a retry): nothing new is sent.
    const again = (
      await req('POST', '/invoices/send', { invoiceIds: ids, requestKey: 'bulk-0001' })
    ).json();
    expect(again.repeated).toBe(true);
    expect(again.queued).toHaveLength(50);
    expect(t.mail.sent).toHaveLength(50);
    expect(await t.prisma.emailDelivery.count()).toBe(50);

    const deliveries = await t.prisma.emailDelivery.findMany({ orderBy: { id: 'asc' } });
    expect(deliveries.every((d) => d.status === 'SENT' && d.providerMessageId)).toBe(true);

    // Every email is delivered, one opens and one bounces.
    const events = deliveries.map((d, i) => ({
      id: `ev-d-${i}`,
      type: 'delivered',
      providerMessageId: d.providerMessageId,
    }));
    expect((await webhook(events)).json().applied).toBe(50);
    await webhook([
      { id: 'ev-o-1', type: 'opened', providerMessageId: deliveries[1]!.providerMessageId },
      {
        id: 'ev-b-7',
        type: 'bounced',
        providerMessageId: deliveries[7]!.providerMessageId,
        detail: 'Mailbox does not exist',
      },
    ]);
    // Replaying an event changes nothing.
    expect(
      (
        await webhook([
          { id: 'ev-o-1', type: 'opened', providerMessageId: deliveries[1]!.providerMessageId },
        ])
      ).json().applied,
    ).toBe(0);

    const statuses = await t.prisma.emailDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count._all]))).toEqual({
      DELIVERED: 48,
      OPENED: 1,
      BOUNCED: 1,
    });
    const bounced = (await req('GET', '/invoices?delivery=BOUNCED')).json();
    expect(bounced.total).toBe(1);
    expect(bounced.items[0].delivery).toMatchObject({
      status: 'BOUNCED',
      toEmail: deliveries[7]!.toEmail,
    });
    const detail = (await req('GET', `/invoices/${bounced.items[0].id}`)).json();
    expect(detail.deliveries[0].events.map((e: { type: string }) => e.type)).toEqual([
      'delivered',
      'bounced',
    ]);
    expect((await req('GET', '')).json().stats.bouncedEmails).toBe(1);
    expect((await req('GET', '/invoices?delivery=NOT_SENT')).json().total).toBe(0);
  });

  it('refuses unsigned webhooks', async () => {
    expect((await webhook([], 'wrong-secret-0000')).statusCode).toBe(401);
    const res = await t.app.inject({
      method: 'POST',
      url: '/webhooks/mail',
      headers: { 'content-type': 'application/json' },
      payload: '{"events":[]}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('skips drafts and clients without email, picks the zero-savings email, and records failures', async () => {
    const ids = await issuedInvoices(3, { email: (i) => (i === 1 ? null : `c${i}@example.com`) });
    // A flat-fee-only client gets the zero-savings email.
    const c = await t.prisma.contact.create({
      data: {
        orgId,
        kind: 'CLIENT',
        displayName: 'Flat Fee',
        email: 'flat@example.com',
        flatFee: '150',
      },
    });
    const p = await t.prisma.property.create({
      data: { orgId, contactId: c.id, countyId, accountNumber: 'FLAT1' },
    });
    await t.prisma.taxYearRecord.create({
      data: {
        orgId,
        propertyId: p.id,
        taxYear: 2026,
        noticeAppraised: '1',
        finalAppraised: '1',
        taxRatePct: '2',
      },
    });
    const [flatId] = (
      await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })
    ).json().createdIds;
    const draft = flatId as number;
    t.mail.refuse.add('c2@example.com');

    const r = (
      await req('POST', '/invoices/send', { invoiceIds: [...ids, draft], requestKey: 'mixed-0001' })
    ).json();
    expect(r.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual([
      'Still a draft: issue it first.',
      'The client has no email address.',
    ]);
    await req('POST', `/invoices/${draft}/issue`, {});
    const z = (
      await req('POST', '/invoices/send', { invoiceIds: [draft], requestKey: 'flat-0001' })
    ).json();
    expect(z.queued[0].templateKey).toBe('INVOICE_ZERO_SAVINGS');
    expect(t.mail.lastTo('flat@example.com')?.subject).toBe('Your 2026 protest results from Firm');

    const failed = await t.prisma.emailDelivery.findFirstOrThrow({
      where: { toEmail: 'c2@example.com' },
    });
    expect(failed).toMatchObject({ status: 'FAILED', error: 'Provider refused c2@example.com' });
  });

  it('emails a payment receipt when asked', async () => {
    const [id] = await issuedInvoices(1);
    const inv = (await req('GET', `/invoices/${id}`)).json();
    const p = await req('POST', '/payments', {
      contactId: inv.contact.id,
      receivedAt: '2026-10-02',
      amount: '100',
      method: 'CHECK',
      reference: '5678',
      sendReceipt: true,
    });
    expect(p.json().receipt).toMatchObject({ status: 'SENT', toEmail: 'client0@example.com' });
    const m = t.mail.lastTo('client0@example.com')!;
    expect(m.subject).toBe('Payment received: thank you');
    expect(m.text).toContain('We received your payment of $100.00 on Oct 2, 2026 (Check 5678).');
    expect(m.text).toContain('Your remaining balance is $200.00.');
  });
});

describe('email templates', () => {
  it('lists defaults, saves an edit used by the next send, previews, and resets', async () => {
    const list = (await req('GET', '/email-templates')).json();
    expect(list.map((x: { key: string }) => x.key)).toEqual([
      'INVOICE',
      'INVOICE_ZERO_SAVINGS',
      'PAYMENT_RECEIPT',
      'DOC_REMINDER',
      'PROSPECT_OUTREACH',
    ]);
    expect(list[0]).toMatchObject({ isCustom: false });

    const bad = await req('PUT', '/email-templates', {
      key: 'INVOICE',
      subject: 'Hi {{invoice.numbr}}',
      body: 'x',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('{{invoice.numbr}}');

    const saved = await req('PUT', '/email-templates', {
      key: 'INVOICE',
      subject: 'Your bill {{invoice.number}}',
      body: 'Dear {{client.displayName}}, you owe {{invoice.total}}.',
    });
    expect(saved.json()).toMatchObject({ isCustom: true, updatedBy: expect.any(String) });
    const preview = (
      await req('POST', '/email-templates/preview', {
        key: 'INVOICE',
        subject: 'S {{invoice.number}}',
        body: 'B <{{client.displayName}}>',
      })
    ).json();
    expect(preview).toMatchObject({ subject: 'S INV-0042' });
    expect(preview.html).toContain('B &lt;Jane Smith&gt;');

    const [id] = await issuedInvoices(1);
    await req('POST', '/invoices/send', { invoiceIds: [id], requestKey: 'tmpl-0001' });
    expect(t.mail.lastTo('client0@example.com')?.text).toBe('Dear Client 0, you owe $300.00.');

    expect((await req('POST', '/email-templates/reset', { key: 'INVOICE' })).json().isCustom).toBe(
      false,
    );
  });

  it('is for admins; staff can send', async () => {
    const staff = await createUser('staff@example.com');
    await addMember(orgId, staff.id, 'STAFF');
    const sc = await login(t.app, 'staff@example.com');
    expect((await req('GET', '/email-templates', undefined, sc)).statusCode).toBe(403);
    expect(
      (await req('PUT', '/email-templates', { key: 'INVOICE', subject: 'x', body: 'y' }, sc))
        .statusCode,
    ).toBe(403);
    const [id] = await issuedInvoices(1);
    expect(
      (await req('POST', '/invoices/send', { invoiceIds: [id], requestKey: 'staff-0001' }, sc))
        .statusCode,
    ).toBe(200);
  });
});
