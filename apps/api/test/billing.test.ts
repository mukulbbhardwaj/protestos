import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createUser,
  login,
  makeTestApp,
  ownerWithOrg,
  resetDb,
  type TestContext,
} from './helpers.js';

// M4 "done when": generate → issue → partially pay → fully pay, balances correct, and editing
// values after issue doesn't change the invoice.

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
  const o = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
  cookie = o.cookie;
  slug = o.org.slug;
  orgId = o.org.id;
  countyId = (
    await t.prisma.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  const s = await req('PATCH', '/settings', {
    defaultContingencyPct: '30',
    defaultFlatFee: '0',
    taxYearDefault: 2026,
    invoicePrefix: 'INV-',
    invoiceDueDays: 30,
    paymentInstructions: 'Zelle billing@example.com',
  });
  expect(s.statusCode).toBe(200);
});

const req = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

async function client(name: string) {
  const r = await req('POST', '/contacts', {
    kind: 'CLIENT',
    displayName: name,
    email: `${name.replace(/\s/g, '').toLowerCase()}@example.com`,
  });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: number };
}

/** A property with a 2026 record carrying the given values; returns the tax-year id. */
async function propertyYear(
  contactId: number,
  account: string,
  values: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const p = await req('POST', '/properties', {
    contactId,
    accountNumber: account,
    countyId,
    taxYear: 2026,
    ...extra,
  });
  expect(p.statusCode).toBe(201);
  const yearId = p.json().taxYears[0].id as number;
  const u = await req('PATCH', `/tax-years/${yearId}`, values);
  expect(u.statusCode).toBe(200);
  return yearId;
}

const stageOf = async (yearId: number) =>
  (await t.prisma.taxYearRecord.findUniqueOrThrow({ where: { id: yearId } })).protestStage;

async function scenario() {
  const jane = await client('Jane Owner');
  const bob = await client('Bob Builder');
  // 500,000 → 450,000 at 2.5% = 1,250 saved × 30% = 375.00
  const y1 = await propertyYear(jane.id, '1041940000001', {
    noticeAppraised: '500000',
    finalAppraised: '450000',
    taxRatePct: '2.5',
  });
  // No reduction but a 150 flat fee on the property.
  const y2 = await propertyYear(
    jane.id,
    '1041940000002',
    { noticeAppraised: '300000', finalAppraised: '300000', taxRatePct: '2' },
    { flatFee: '150' },
  );
  // No tax rate yet: skipped with a reason.
  await propertyYear(bob.id, '1041940000003', {
    noticeAppraised: '300000',
    finalAppraised: '250000',
  });
  // No final value: not eligible at all.
  await propertyYear(bob.id, '1041940000004', { noticeAppraised: '300000' });
  return { jane, bob, y1, y2 };
}

describe('invoicing', () => {
  it('generates, issues, part-pays and fully pays with correct balances and frozen values', async () => {
    const { jane, y1, y2 } = await scenario();

    const preview = await req('POST', '/invoices/generate', { taxYear: 2026 });
    expect(preview.statusCode).toBe(200);
    const pv = preview.json();
    expect(pv.invoices).toHaveLength(1);
    expect(pv.invoices[0].total).toBe('525.00');
    expect(
      pv.invoices[0].lines.map((l: { kind: string; amount: string }) => `${l.kind} ${l.amount}`),
    ).toEqual(['CONTINGENCY 375.00', 'FLAT 150.00']);
    expect(pv.skipped).toEqual([
      { property: 'Harris 1041940000003', client: 'Bob Builder', reason: 'Missing the tax rate.' },
    ]);
    expect(await t.prisma.invoice.count()).toBe(0);

    const created = (
      await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })
    ).json();
    expect(created.createdIds).toHaveLength(1);
    const id = created.createdIds[0] as number;
    // Already invoiced property-years aren't offered again.
    expect(
      (await req('POST', '/invoices/generate', { taxYear: 2026 })).json().invoices,
    ).toHaveLength(0);

    let inv = (
      await req('POST', `/invoices/${id}/lines`, { description: 'Loyalty discount', amount: '-25' })
    ).json();
    expect(inv.total).toBe('500.00');
    expect(inv.status).toBe('DRAFT');
    expect(inv.number).toBeNull();

    // A value changed before issue is picked up: 100,000 reduction → 750.00.
    await req('PATCH', `/tax-years/${y1}`, { finalAppraised: '400000' });
    const issued = await req('POST', `/invoices/${id}/issue`, { issueDate: '2026-09-01' });
    expect(issued.statusCode).toBe(200);
    inv = issued.json();
    expect(inv).toMatchObject({
      number: 'INV-0001',
      status: 'ISSUED',
      total: '875.00',
      balance: '875.00',
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      hasPdf: true,
    });
    expect(await stageOf(y1)).toBe('INVOICED');
    expect(await stageOf(y2)).toBe('INVOICED');
    const pdf1 = await req('GET', `/invoices/${id}/pdf`);
    expect(pdf1.headers['content-type']).toBe('application/pdf');
    expect(pdf1.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    // Editing values after issue changes nothing on the invoice or its PDF.
    await req('PATCH', `/tax-years/${y1}`, { finalAppraised: '300000', taxRatePct: '3' });
    await req('PATCH', '/settings', { defaultContingencyPct: '40' });
    const after = (await req('GET', `/invoices/${id}`)).json();
    expect(after.total).toBe('875.00');
    expect(after.lines[0].amount).toBe('750.00');
    expect(after.lines[0].snapshot.values.finalAppraised).toBe('400000');
    expect((await req('GET', `/invoices/${id}/pdf`)).rawPayload.equals(pdf1.rawPayload)).toBe(true);
    // An issued invoice can't be edited.
    expect(
      (await req('POST', `/invoices/${id}/lines`, { description: 'x', amount: '1' })).statusCode,
    ).toBe(409);

    // Partial payment, allocated automatically.
    const p1 = await req('POST', '/payments', {
      contactId: jane.id,
      receivedAt: '2026-09-10',
      amount: '300',
      method: 'CHECK',
      reference: '1001',
    });
    expect(p1.statusCode).toBe(201);
    expect(p1.json()).toMatchObject({ allocated: '300.00', unallocated: '0.00' });
    inv = (await req('GET', `/invoices/${id}`)).json();
    expect(inv).toMatchObject({
      status: 'PARTIALLY_PAID',
      amountPaid: '300.00',
      balance: '575.00',
    });
    expect(await stageOf(y1)).toBe('INVOICED');

    // Overpayment: the invoice is paid and 25.00 stays as credit.
    const p2 = (
      await req('POST', '/payments', {
        contactId: jane.id,
        receivedAt: '2026-09-20',
        amount: '600',
        method: 'ZELLE',
      })
    ).json();
    expect(p2).toMatchObject({ allocated: '575.00', unallocated: '25.00' });
    inv = (await req('GET', `/invoices/${id}`)).json();
    expect(inv).toMatchObject({ status: 'PAID', balance: '0.00', amountPaid: '875.00' });
    expect(inv.payments).toHaveLength(2);
    expect(await stageOf(y1)).toBe('PAID');
    const billing = (await req('GET', `/contacts/${jane.id}/billing`)).json();
    expect(billing).toMatchObject({ credit: '25.00', openBalance: '0.00', openInvoices: [] });

    // Deleting a payment reopens the invoice and its stage.
    expect((await req('DELETE', `/payments/${p2.id}`)).statusCode).toBe(200);
    inv = (await req('GET', `/invoices/${id}`)).json();
    expect(inv).toMatchObject({ status: 'PARTIALLY_PAID', balance: '575.00' });
    expect(await stageOf(y1)).toBe('INVOICED');
    expect((await req('GET', '/invoices?status=OPEN')).json().totals).toMatchObject({
      count: 1,
      balance: '575.00',
    });

    const statement = await req('GET', `/contacts/${jane.id}/statement.pdf`);
    expect(statement.statusCode).toBe(200);
    expect(statement.headers['content-type']).toBe('application/pdf');

    const actions = (
      await t.prisma.auditLog.findMany({ where: { orgId }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'invoice.generated',
        'invoice.issued',
        'payment.recorded',
        'payment.deleted',
      ]),
    );
  });

  it('voids (money back to credit, property-years billable again) and writes off', async () => {
    const { jane, y1 } = await scenario();
    const id = (await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })).json()
      .createdIds[0];
    await req('POST', `/invoices/${id}/issue`, {});
    await req('POST', '/payments', {
      contactId: jane.id,
      receivedAt: '2026-09-10',
      amount: '100',
      method: 'CASH',
    });

    expect((await req('POST', `/invoices/${id}/void`, { reason: '' })).statusCode).toBe(400);
    const voided = (await req('POST', `/invoices/${id}/void`, { reason: 'Wrong client' })).json();
    expect(voided).toMatchObject({ status: 'VOID', voidReason: 'Wrong client', payments: [] });
    expect(await stageOf(y1)).toBe('NOT_STARTED');
    expect((await req('GET', `/contacts/${jane.id}/billing`)).json().credit).toBe('100.00');

    // Billable again; the new invoice gets the next number and the credit can be applied.
    const id2 = (await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })).json()
      .createdIds[0];
    expect((await req('POST', `/invoices/${id2}/issue`, {})).json().number).toBe('INV-0002');
    expect((await req('POST', `/contacts/${jane.id}/apply-credit`)).json().applied).toBe('100.00');
    const inv2 = (await req('GET', `/invoices/${id2}`)).json();
    expect(inv2).toMatchObject({ status: 'PARTIALLY_PAID', balance: '425.00' });

    const off = (
      await req('POST', `/invoices/${id2}/write-off`, { reason: 'Client moved away' })
    ).json();
    expect(off).toMatchObject({ status: 'WRITTEN_OFF', writeOffReason: 'Client moved away' });
    expect(
      (await req('POST', `/invoices/${id2}/write-off`, { reason: 'Again please' })).statusCode,
    ).toBe(409);
    expect((await req('GET', '/invoices?status=OPEN')).json().total).toBe(0);
  });

  it('groups per property when the firm chooses it, and deletes drafts', async () => {
    await scenario();
    await req('PATCH', '/settings', { invoiceGrouping: 'PROPERTY_YEAR' });
    const r = (await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })).json();
    expect(r.grouping).toBe('PROPERTY_YEAR');
    expect(
      r.invoices.map((i: { total: string; template: string }) => `${i.total} ${i.template}`),
    ).toEqual(['375.00 STANDARD', '150.00 ZERO_SAVINGS']);
    expect((await req('DELETE', `/invoices/${r.createdIds[0]}`)).statusCode).toBe(200);
    expect((await req('GET', `/invoices/${r.createdIds[0]}`)).statusCode).toBe(404);
    // Removing a draft's last line removes the draft.
    const inv = (await req('GET', `/invoices/${r.createdIds[1]}`)).json();
    const del = (await req('DELETE', `/invoices/${inv.id}/lines/${inv.lines[0].id}`)).json();
    expect(del.deleted).toBe(true);
  });

  it('checks hand-entered allocations', async () => {
    const { jane } = await scenario();
    const id = (await req('POST', '/invoices/generate?dryRun=false', { taxYear: 2026 })).json()
      .createdIds[0];
    await req('POST', `/invoices/${id}/issue`, {});
    const tooMuch = await req('POST', '/payments', {
      contactId: jane.id,
      receivedAt: '2026-09-10',
      amount: '1000',
      method: 'ACH',
      allocations: [{ invoiceId: id, amount: '600' }],
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.message).toBe("That's more than the invoice's balance of $525.00.");
    const credit = await req('POST', '/payments', {
      contactId: jane.id,
      receivedAt: '2026-09-10',
      amount: '50',
      method: 'ACH',
      allocations: [],
    });
    expect(credit.json()).toMatchObject({ allocated: '0.00', unallocated: '50.00' });
    expect((await req('GET', `/invoices/${id}`)).json().status).toBe('ISSUED');
  });

  it('lets read-only members look but not change', async () => {
    await scenario();
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const vc = await login(t.app, 'viewer@example.com');
    expect((await req('GET', '/invoices', undefined, vc)).statusCode).toBe(200);
    expect((await req('GET', '/payments', undefined, vc)).statusCode).toBe(200);
    expect((await req('POST', '/invoices/generate', { taxYear: 2026 }, vc)).statusCode).toBe(403);
  });
});
