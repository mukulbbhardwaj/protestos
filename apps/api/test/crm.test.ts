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

let t: TestContext;
let cookie: string;
let slug: string;
let orgId: number;
let countyId: number;
let ownerId: number;

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
  ownerId = o.user.id;
  countyId = (
    await t.prisma.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  await t.prisma.org.update({ where: { id: orgId }, data: { taxYearDefault: 2026 } });
});

const req = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, c = cookie) =>
  t.app.inject({
    method,
    url: `/orgs/${slug}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

async function client(name = 'Jane Smith') {
  return (
    await req('POST', '/contacts', { kind: 'CLIENT', displayName: name, email: 'jane@example.com' })
  ).json();
}

async function property(contactId: number, account = '0660640130020') {
  const res = await req('POST', '/properties', {
    contactId,
    accountNumber: account,
    countyId,
    taxYear: 2026,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('contacts', () => {
  it('assigns sequential client numbers and audits creation', async () => {
    const a = await client('A');
    const b = await client('B');
    expect([a.clientNumber, b.clientNumber]).toEqual(['1001', '1002']);
    expect(a.convertedAt).not.toBeNull();
    const audit = (await req('GET', `/audit-log?entityType=Contact&entityId=${a.id}`)).json();
    expect(audit.entries[0].action).toBe('contact.created');
  });

  it('converts a prospect once, keeping the original sign-up date', async () => {
    const p = (await req('POST', '/contacts', { kind: 'PROSPECT', displayName: 'Lead' })).json();
    expect(p).toMatchObject({ kind: 'PROSPECT', status: 'NEW', clientNumber: null });
    const converted = (await req('POST', `/contacts/${p.id}/convert`)).json();
    expect(converted).toMatchObject({ kind: 'CLIENT', clientNumber: '1001', status: 'SIGNED' });

    // A re-conversion (e.g. after data fixes) must never overwrite convertedAt.
    const original = new Date('2020-05-01T00:00:00Z');
    await t.prisma.contact.update({
      where: { id: p.id },
      data: { kind: 'PROSPECT', convertedAt: original },
    });
    const again = (await req('POST', `/contacts/${p.id}/convert`)).json();
    expect(again.convertedAt).toBe(original.toISOString());
    expect(again.clientNumber).toBe('1001');
    expect((await req('POST', `/contacts/${p.id}/convert`)).statusCode).toBe(409);
  });

  it('archives with its properties and restores only those', async () => {
    const c = await client();
    const p1 = await property(c.id, 'A1');
    const p2 = await property(c.id, 'A2');
    await req('POST', `/properties/${p2.id}/archive`); // archived on its own, earlier
    expect((await req('POST', `/contacts/${c.id}/archive`)).json().archivedAt).not.toBeNull();
    expect((await req('GET', `/properties/${p1.id}`)).json().archivedWithContact).toBe(true);

    await req('POST', `/contacts/${c.id}/restore`);
    expect((await req('GET', `/properties/${p1.id}`)).json().archivedAt).toBeNull();
    expect((await req('GET', `/properties/${p2.id}`)).json().archivedAt).not.toBeNull();
  });

  it('lists with search, filters, counts and pagination', async () => {
    await client('Alpha Holdings LLC');
    await client('Beta Partners LP');
    await req('POST', '/contacts', { kind: 'PROSPECT', displayName: 'Gamma', status: 'CONTACTED' });
    const all = (await req('GET', '/contacts?pageSize=1')).json();
    expect(all).toMatchObject({ total: 2, pageSize: 1 });
    expect(all.items).toHaveLength(1);
    expect(
      (await req('GET', '/contacts?q=beta'))
        .json()
        .items.map((c: { displayName: string }) => c.displayName),
    ).toEqual(['Beta Partners LP']);
    expect((await req('GET', '/contacts?kind=PROSPECT')).json().total).toBe(1);
    expect((await req('GET', '/contacts/prospect-counts')).json()).toMatchObject({
      total: 1,
      counts: { CONTACTED: 1, NEW: 0 },
    });
  });

  it('records a field-level diff on update', async () => {
    const c = await client();
    await req('PATCH', `/contacts/${c.id}`, { phone: '(713) 555-0100', contingencyPct: '35' });
    const [entry] = (await req('GET', `/audit-log?entityType=Contact&entityId=${c.id}`)).json()
      .entries;
    expect(entry.action).toBe('contact.updated');
    expect(entry.after).toEqual({ phone: '(713) 555-0100', contingencyPct: '35' });
  });

  it('READ_ONLY users can read but not create', async () => {
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const vc = await login(t.app, 'viewer@example.com');
    expect((await req('GET', '/contacts', undefined, vc)).statusCode).toBe(200);
    expect(
      (await req('POST', '/contacts', { kind: 'CLIENT', displayName: 'X' }, vc)).statusCode,
    ).toBe(403);
  });
});

describe('properties and tax years', () => {
  it('normalizes account numbers, rejects duplicates per county, and starts a tax year', async () => {
    const c = await client();
    const p = await property(c.id, ' r 123 456 ');
    expect(p.accountNumber).toBe('R123456');
    expect(p.taxYears).toHaveLength(1);
    expect(p.stageEvents[0]).toMatchObject({ toStage: 'NOT_STARTED', taxYear: 2026 });
    const dup = await req('POST', '/properties', {
      contactId: c.id,
      accountNumber: 'R123456',
      countyId,
    });
    expect(dup.statusCode).toBe(409);
  });

  it('only accepts consultants who are members of the firm', async () => {
    const c = await client();
    const outsider = await createUser('outsider@example.com');
    const res = await req('POST', '/properties', {
      contactId: c.id,
      accountNumber: 'X',
      countyId,
      consultantUserId: outsider.id,
    });
    expect(res.statusCode).toBe(400);
    const ok = await req('POST', '/properties', {
      contactId: c.id,
      accountNumber: 'X',
      countyId,
      consultantUserId: ownerId,
    });
    expect(ok.json().consultant.id).toBe(ownerId);
  });

  it('saves values (0% override stays 0) and exposes fee context', async () => {
    const c = await client();
    const p = await property(c.id);
    const year = p.taxYears[0];
    const res = await req('PATCH', `/tax-years/${year.id}`, {
      noticeAppraised: '450000',
      finalAppraised: '410000',
      taxRatePct: '2.15',
      contingencyPctOverride: '0',
      noticeReceivedAt: '2026-04-10',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      noticeAppraised: '450000.00',
      finalAppraised: '410000.00',
      taxRatePct: '2.15',
      contingencyPctOverride: '0',
      noticeReceivedAt: '2026-04-10',
    });
    const detail = (await req('GET', `/properties/${p.id}`)).json();
    expect(detail.feeContext).toMatchObject({
      savingsBasis: 'APPRAISED',
      currentTaxYear: 2026,
      firm: { defaultContingencyPct: '30' },
    });
  });

  it('changes stage with history, and refuses system-only stages', async () => {
    const c = await client();
    const year = (await property(c.id)).taxYears[0];
    await req('POST', `/tax-years/${year.id}/stage`, {
      stage: 'PROTEST_FILED',
      note: 'Filed online',
    });
    const detail = (
      await req(
        'GET',
        `/properties/${(await t.prisma.taxYearRecord.findUniqueOrThrow({ where: { id: year.id } })).propertyId}`,
      )
    ).json();
    expect(detail.stageEvents[0]).toMatchObject({
      fromStage: 'NOT_STARTED',
      toStage: 'PROTEST_FILED',
      note: 'Filed online',
    });
    expect((await req('POST', `/tax-years/${year.id}/stage`, { stage: 'PAID' })).statusCode).toBe(
      400,
    );
  });

  it('bulk assigns, sets stages and rolls over', async () => {
    const c = await client();
    const ids = [(await property(c.id, 'B1')).id, (await property(c.id, 'B2')).id];
    expect(
      (
        await req('POST', '/properties/bulk/assign-consultant', { ids, consultantUserId: ownerId })
      ).json(),
    ).toEqual({ updated: 2, skipped: 0 });
    expect(
      (
        await req('POST', '/properties/bulk/stage', { ids, taxYear: 2026, stage: 'SETTLED' })
      ).json(),
    ).toEqual({ updated: 2, skipped: 0 });
    expect(
      (
        await req('POST', '/properties/bulk/stage', { ids, taxYear: 2026, stage: 'SETTLED' })
      ).json(),
    ).toEqual({ updated: 0, skipped: 2 });
    expect((await req('POST', '/properties/bulk/rollover', { ids, taxYear: 2027 })).json()).toEqual(
      { updated: 2, skipped: 0 },
    );
    expect((await req('POST', '/properties/bulk/rollover', { ids, taxYear: 2027 })).json()).toEqual(
      { updated: 0, skipped: 2 },
    );
    const list = (
      await req('GET', `/properties?stage=SETTLED&taxYear=2026&consultantId=${ownerId}`)
    ).json();
    expect(list.total).toBe(2);
  });

  it('search finds contacts and properties, and the dashboard counts them', async () => {
    const c = await client('Westpark Holdings');
    await property(c.id, '0660640130020');
    const r = (await req('GET', '/search?q=westpark')).json();
    expect(r.contacts[0].displayName).toBe('Westpark Holdings');
    expect((await req('GET', '/search?q=06606401')).json().properties[0].accountNumber).toBe(
      '0660640130020',
    );
    const overview = (await req('GET', '')).json();
    expect(overview.stats).toMatchObject({
      taxYear: 2026,
      activeClients: 1,
      propertiesThisYear: 1,
    });
    expect(overview.checklist.importedData).toBe(true);
  });

  it('lists the 254 counties for logged-in users only', async () => {
    expect((await t.app.inject({ url: '/counties' })).statusCode).toBe(401);
    const res = await t.app.inject({ url: '/counties', headers: { cookie } });
    expect(res.json().counties.map((c: { name: string }) => c.name)).toContain('Harris');
  });
});
