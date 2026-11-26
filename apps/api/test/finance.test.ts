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

// M7 "done when": the finance dashboard matches a hand-calculated fixture.
//
// As of 2026-03-15. Two clients, Alice (Harris home) and Bob (Fort Bend commercial):
//   I1 Alice  issued 2025-11-10 due 2025-12-10  1,000  paid 400 (check 2025-12-05)  → 600 open, 95 days late (90+)
//   I2 Alice  issued 2026-01-20 due 2026-02-19    500  paid 500 (Zelle 2026-02-01)  → paid
//   I3 Bob    issued 2026-03-02 due 2026-04-01    800  unpaid                       → 800 not yet due
//   I4 Bob    issued 2026-02-10 due 2026-03-01    300  paid 100 (ACH 2026-03-05)    → 200, 14 days late (0-30)
//   I5 Alice  issued 2025-06-01 written off       250  → billed in 2025, not outstanding
//   I6 Bob    issued 2026-01-05 VOID              777  → ignored;  D1 Alice DRAFT 999 → ignored
//   P4 Bob    cash 50 on 2026-03-10, not applied (credit)
// Hand totals:
//   This month (Mar 1–15): billed 800 (I3); collected 100 + 50 = 150
//   Last month (Feb):      billed 300 (I4); collected 500
//   YTD:                   billed 500 + 800 + 300 = 1,600; collected 500 + 100 + 50 = 650 → 40.6%
//   2025:                  billed 1,000 + 250 = 1,250; collected 400
//   Outstanding 1,600 (3 invoices): not due 800, 0-30 200, 90+ 600
//   By client: Bob 1,000 (200 past due, 2), Alice 600 (600 past due, 1)
//   Billed by county (YTD): Fort Bend 1,100, Harris 500
//   2025 savings: Alice 500,000 → 450,000 at 2.5% = 50,000 reduced, 1,250 saved; Bob's went up.
//   Fort Bend only: YTD billed 1,100, collected 100 (cash credit isn't applied to an invoice).

let t: TestContext;
let cookie: string;
let slug: string;
let orgId: number;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());

let ids: { harris: number; fortBend: number; alice: number; bob: number };

beforeEach(async () => {
  await resetDb();
  const o = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
  cookie = o.cookie;
  slug = o.org.slug;
  orgId = o.org.id;
  await req('PATCH', '/settings', { taxYearDefault: 2025 });
  const p = t.prisma;
  const harris = (
    await p.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  const fortBend = (
    await p.county.create({ data: { state: 'TX', name: 'Fort Bend', cadName: 'Fort Bend CAD' } })
  ).id;
  const alice = (
    await p.contact.create({
      data: { orgId, kind: 'CLIENT', displayName: 'Alice', clientNumber: '1' },
    })
  ).id;
  const bob = (
    await p.contact.create({
      data: { orgId, kind: 'CLIENT', displayName: 'Bob', clientNumber: '2' },
    })
  ).id;
  const h1 = (
    await p.property.create({
      data: { orgId, contactId: alice, countyId: harris, accountNumber: 'H1' },
    })
  ).id;
  const f1 = (
    await p.property.create({
      data: {
        orgId,
        contactId: bob,
        countyId: fortBend,
        accountNumber: 'F1',
        propertyType: 'COMMERCIAL',
      },
    })
  ).id;
  await p.taxYearRecord.create({
    data: {
      orgId,
      propertyId: h1,
      taxYear: 2025,
      noticeAppraised: '500000',
      finalAppraised: '450000',
      taxRatePct: '2.5',
      resultType: 'SETTLEMENT',
    },
  });
  await p.taxYearRecord.create({
    data: {
      orgId,
      propertyId: f1,
      taxYear: 2025,
      noticeAppraised: '300000',
      finalAppraised: '310000',
      taxRatePct: '2',
      resultType: 'NO_CHANGE',
    },
  });
  const inv = async (
    contactId: number,
    propertyId: number,
    number: string,
    status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'WRITTEN_OFF' | 'VOID' | 'DRAFT',
    issue: string | null,
    due: string | null,
    total: string,
    paid: string,
  ) => {
    const i = await p.invoice.create({
      data: {
        orgId,
        contactId,
        number: status === 'DRAFT' ? null : number,
        taxYear: 2025,
        status,
        issueDate: issue ? new Date(issue) : null,
        dueDate: due ? new Date(due) : null,
        subtotal: total,
        total,
        amountPaid: paid,
        balance: (Number(total) - Number(paid)).toFixed(2),
      },
    });
    await p.invoiceLine.create({
      data: {
        orgId,
        invoiceId: i.id,
        propertyId,
        kind: 'CONTINGENCY',
        description: 'Fee',
        amount: total,
      },
    });
    return i.id;
  };
  const pay = async (
    contactId: number,
    day: string,
    amount: string,
    method: 'CHECK' | 'ZELLE' | 'ACH' | 'CASH',
    invoiceId?: number,
  ) => {
    const pm = await p.payment.create({
      data: { orgId, contactId, receivedAt: new Date(day), amount, method },
    });
    if (invoiceId)
      await p.paymentAllocation.create({ data: { orgId, paymentId: pm.id, invoiceId, amount } });
  };
  const i1 = await inv(
    alice,
    h1,
    'I1',
    'PARTIALLY_PAID',
    '2025-11-10',
    '2025-12-10',
    '1000',
    '400',
  );
  const i2 = await inv(alice, h1, 'I2', 'PAID', '2026-01-20', '2026-02-19', '500', '500');
  await inv(bob, f1, 'I3', 'ISSUED', '2026-03-02', '2026-04-01', '800', '0');
  const i4 = await inv(bob, f1, 'I4', 'PARTIALLY_PAID', '2026-02-10', '2026-03-01', '300', '100');
  await inv(alice, h1, 'I5', 'WRITTEN_OFF', '2025-06-01', '2025-07-01', '250', '0');
  await inv(bob, f1, 'I6', 'VOID', '2026-01-05', '2026-02-04', '777', '0');
  await inv(alice, h1, 'D1', 'DRAFT', null, null, '999', '0');
  await pay(alice, '2025-12-05', '400', 'CHECK', i1);
  await pay(alice, '2026-02-01', '500', 'ZELLE', i2);
  await pay(bob, '2026-03-05', '100', 'ACH', i4);
  await pay(bob, '2026-03-10', '50', 'CASH');
  ids = { harris, fortBend, alice, bob };
});

const req = (method: 'GET' | 'PATCH', path: string, payload?: object, c = cookie) =>
  t.app.inject({
    method,
    url: `/orgs/${slug}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });
const dashboard = async (q = '') => {
  const r = await req('GET', `/finance/dashboard?asOf=2026-03-15${q}`);
  expect(r.statusCode).toBe(200);
  return r.json();
};

describe('finance dashboard', () => {
  it('matches the hand-calculated fixture', async () => {
    const d = await dashboard();
    expect(d.kpis).toEqual({
      thisMonth: { billed: '800.00', collected: '150.00' },
      lastMonth: { billed: '300.00', collected: '500.00' },
      ytd: { billed: '1600.00', collected: '650.00' },
      lastYear: { billed: '1250.00', collected: '400.00' },
      collectionRateYtd: '40.6',
    });
    expect(d.outstanding).toEqual({
      total: '1600.00',
      count: 3,
      buckets: {
        NOT_DUE: '800.00',
        '0-30': '200.00',
        '31-60': '0.00',
        '61-90': '0.00',
        '90+': '600.00',
      },
    });
    expect(d.topOutstanding).toEqual([
      {
        contact: { id: ids.bob, displayName: 'Bob', clientNumber: '2' },
        balance: '1000.00',
        pastDue: '200.00',
        invoices: 2,
      },
      {
        contact: { id: ids.alice, displayName: 'Alice', clientNumber: '1' },
        balance: '600.00',
        pastDue: '600.00',
        invoices: 1,
      },
    ]);
    expect(d.byCounty).toEqual([
      { county: 'Fort Bend', billed: '1100.00' },
      { county: 'Harris', billed: '500.00' },
    ]);
    expect(d.savings).toEqual({
      taxYear: 2025,
      properties: 2,
      valueReduced: '50000.00',
      taxSavings: '1250.00',
    });
    expect(d.outcomes.at(-1)).toEqual({
      taxYear: 2025,
      settled: 1,
      boardOrder: 0,
      noChange: 1,
      withdrawn: 0,
      pending: 0,
    });
    expect(d.range).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly[0].month).toBe('2025-04');
    const m = Object.fromEntries(
      d.monthly.map((x: { month: string; billed: string; collected: string }) => [
        x.month,
        `${x.billed}/${x.collected}`,
      ]),
    );
    expect(m).toMatchObject({
      '2025-06': '250.00/0.00',
      '2025-11': '1000.00/0.00',
      '2025-12': '0.00/400.00',
      '2026-01': '500.00/0.00',
      '2026-02': '300.00/500.00',
      '2026-03': '800.00/150.00',
    });
    expect(
      d.recentPayments.map((p: { method: string; amount: string }) => `${p.method} ${p.amount}`),
    ).toEqual(['CASH 50.00', 'ACH 100.00', 'ZELLE 500.00']);
  });

  it('applies filters: county counts only money applied to its invoices; method filters collections', async () => {
    const fb = await dashboard(`&countyId=${ids.fortBend}`);
    expect(fb.kpis.ytd).toEqual({ billed: '1100.00', collected: '100.00' });
    expect(fb.outstanding.total).toBe('1000.00');
    expect(fb.savings).toMatchObject({ properties: 1, valueReduced: '0.00' });
    const checks = await dashboard('&method=CHECK');
    expect(checks.kpis.lastYear.collected).toBe('400.00');
    expect(checks.kpis.ytd.collected).toBe('0.00');
    const commercial = await dashboard('&propertyType=COMMERCIAL&from=2026-02-01&to=2026-02-28');
    expect(commercial.byCounty).toEqual([{ county: 'Fort Bend', billed: '300.00' }]);
    expect(commercial.recentPayments).toEqual([]);
  });

  it('is for owners and admins only', async () => {
    const staff = await createUser('staff@example.com');
    await addMember(orgId, staff.id, 'STAFF');
    const sc = await login(t.app, 'staff@example.com');
    expect((await req('GET', '/finance/dashboard', undefined, sc)).statusCode).toBe(403);
  });
});
