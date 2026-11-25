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

const SUBJECT = '0660640130020';

/** A Harris neighborhood: the subject at $400k plus 12 neighbors at $130/sq ft (→ $360k). */
async function seedRoll() {
  const base = {
    countyId,
    taxYear: 2026,
    stateClass: 'A1',
    neighborhoodCode: '8401.01',
    qualityCode: 'B',
  };
  await t.prisma.cadParcel.create({
    data: {
      ...base,
      accountNumber: SUBJECT,
      ownerName: 'SMITH JANE',
      situsLine: '1 MAIN ST',
      situsZip: '77002',
      landValue: '100000',
      improvementValue: '300000',
      marketValue: '400000',
      appraisedValue: '400000',
      livingAreaSqft: 2000,
      yearBuilt: 2005,
      homestead: true,
      units: [
        { code: '001', taxableValue: '400000', exemptPct: '0' },
        { code: '040', taxableValue: '320000', exemptPct: '20' },
      ],
    },
  });
  await t.prisma.cadParcel.createMany({
    data: Array.from({ length: 12 }, (_, i) => {
      const area = 1900 + i * 15;
      return {
        ...base,
        accountNumber: `06606401300${String(30 + i)}`,
        ownerName: `NEIGHBOR ${i}`,
        situsLine: `${10 + i} OAK ST`,
        landValue: '90000',
        improvementValue: String(130 * area),
        marketValue: String(90000 + 130 * area),
        appraisedValue: String(90000 + 130 * area),
        livingAreaSqft: area,
        yearBuilt: 2003 + (i % 4),
      };
    }),
  });
  await t.prisma.cadTaxUnit.createMany({
    data: [
      { countyId, taxYear: 2026, code: '001', name: 'Houston ISD', kind: 'SCHOOL', ratePct: '1.0' },
      {
        countyId,
        taxYear: 2026,
        code: '040',
        name: 'Harris County',
        kind: 'COUNTY',
        ratePct: '0.38',
      },
    ],
  });
  await t.prisma.cadLoad.create({
    data: {
      countyId,
      taxYear: 2026,
      source: 'test',
      files: [],
      parcelCount: 13,
      notes: ['No owner names in this county.'],
    },
  });
}

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
  await seedRoll();
});

const req = (method: 'GET' | 'POST', path: string, payload?: object, c = cookie, s = slug) =>
  t.app.inject({
    method,
    url: `/orgs/${s}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

const estimateUrl = (account = SUBJECT, extra = '') =>
  `/calculator/estimate?countyId=${countyId}&taxYear=2026&account=${account}${extra}`;

describe('calculator', () => {
  it('lists loaded counties and years', async () => {
    const res = await req('GET', '/calculator/coverage');
    expect(res.json()).toEqual([{ countyId, countyName: 'Harris', taxYears: [2026] }]);
  });

  it('searches the roll by account prefix, address and owner', async () => {
    const q = (s: string) =>
      req('GET', `/calculator/search?countyId=${countyId}&taxYear=2026&q=${encodeURIComponent(s)}`);
    expect(
      (await q('0660-6401-3002')).json().map((r: { accountNumber: string }) => r.accountNumber),
    ).toEqual([SUBJECT]);
    expect((await q('main st')).json()).toEqual([
      {
        accountNumber: SUBJECT,
        ownerName: 'SMITH JANE',
        situsLine: '1 MAIN ST',
        situsZip: '77002',
        stateClass: 'A1',
        marketValue: '400000.00',
        appraisedValue: '400000.00',
      },
    ]);
    expect((await q('smith')).json()).toHaveLength(1);
    expect((await q('oak st')).json()).toHaveLength(12);
    expect((await q('x')).statusCode).toBe(400);
  });

  it('estimates with per-unit savings and the firm default contingency', async () => {
    const res = await req('GET', estimateUrl('0660-640-130-020'));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      county: { id: countyId, name: 'Harris' },
      taxYear: 2026,
      parcel: { accountNumber: SUBJECT, livingAreaSqft: 2000, homestead: true },
      contingencySource: 'FIRM',
      property: null,
      estimate: {
        status: 'ESTIMATE',
        confidence: 'HIGH',
        indicatedValue: '360000.00',
        appraisedReduction: '40000.00',
        // ISD 40,000 × 1% = 400; county 32,000 × 0.38% = 121.60
        taxSavings: '521.60',
        contingencyPct: '30.0000',
        firmFee: '156.48',
        clientKeeps: '365.12',
      },
    });
    expect(body.estimate.comps).toHaveLength(12);
    // The county's known data gaps travel with every estimate.
    expect(body.estimate.warnings).toEqual(['No owner names in this county.']);
    expect(body.estimate.units.map((u: { name: string }) => u.name)).toEqual([
      'Houston ISD',
      'Harris County',
    ]);
  });

  it('takes a what-if contingency', async () => {
    const body = (await req('GET', estimateUrl(SUBJECT, '&contingencyPct=25'))).json();
    expect(body.contingencySource).toBe('WHAT_IF');
    expect(body.estimate.firmFee).toBe('130.40');
  });

  it('404s for an account that is not on the roll', async () => {
    const res = await req('GET', estimateUrl('9999999999999'));
    expect(res.statusCode).toBe(404);
  });

  it('creates a prospect with the property and this year’s roll values', async () => {
    const res = await req('POST', '/calculator/prospect', {
      countyId,
      taxYear: 2026,
      account: SUBJECT,
      displayName: 'Jane Smith',
      email: 'JANE@example.com',
    });
    expect(res.statusCode).toBe(201);
    const { contactId, propertyId } = res.json();
    const contact = await t.prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact).toMatchObject({
      orgId,
      kind: 'PROSPECT',
      status: 'NEW',
      email: 'jane@example.com',
      nameOnCad: 'SMITH JANE',
    });
    const year = await t.prisma.taxYearRecord.findFirstOrThrow({ where: { propertyId } });
    expect(year).toMatchObject({ taxYear: 2026, homestead: true });
    expect(year.noticeMarket?.toString()).toBe('400000');
    expect(await t.prisma.auditLog.count({ where: { orgId } })).toBeGreaterThanOrEqual(2);

    // The estimate now links to the firm's property, and a second create is refused.
    const est = (await req('GET', estimateUrl())).json();
    expect(est.property).toEqual({
      id: propertyId,
      contactId,
      contactName: 'Jane Smith',
      archived: false,
    });
    const again = await req('POST', '/calculator/prospect', {
      countyId,
      taxYear: 2026,
      account: SUBJECT,
      displayName: 'Jane Smith',
    });
    expect(again.statusCode).toBe(409);
  });

  it('uses the client’s contingency once the account is the firm’s', async () => {
    const created = (
      await req('POST', '/calculator/prospect', {
        countyId,
        taxYear: 2026,
        account: SUBJECT,
        displayName: 'Jane Smith',
      })
    ).json();
    await t.prisma.contact.update({
      where: { id: created.contactId },
      data: { contingencyPct: '20' },
    });
    const est = (await req('GET', estimateUrl())).json();
    expect(est).toMatchObject({ contingencySource: 'CLIENT', estimate: { firmFee: '104.32' } });
  });

  it('never shows another firm’s property or fee terms', async () => {
    const other = await ownerWithOrg(t.app, 'owner@bravo.test', 'Bravo');
    const made = await req(
      'POST',
      '/calculator/prospect',
      { countyId, taxYear: 2026, account: SUBJECT, displayName: 'Bravo Prospect' },
      other.cookie,
      other.org.slug,
    );
    expect(made.statusCode).toBe(201);
    await t.prisma.contact.update({
      where: { id: made.json().contactId },
      data: { contingencyPct: '5' },
    });
    const est = await req('GET', estimateUrl());
    expect(est.json()).toMatchObject({ property: null, contingencySource: 'FIRM' });
    expect(est.body).not.toMatch(/bravo/i);
    // And this firm can still add the same public account as its own prospect.
    const mine = await req('POST', '/calculator/prospect', {
      countyId,
      taxYear: 2026,
      account: SUBJECT,
      displayName: 'Jane Smith',
    });
    expect(mine.statusCode).toBe(201);
  });

  it('links a firm property typed with dashes, archived or not, and refuses a duplicate', async () => {
    const contact = await t.prisma.contact.create({
      data: { orgId, kind: 'CLIENT', clientNumber: '1001', displayName: 'Jane Smith' },
    });
    const property = await t.prisma.property.create({
      data: { orgId, contactId: contact.id, countyId, accountNumber: '066-064-013-0020' },
    });
    const est = (await req('GET', estimateUrl())).json();
    expect(est.property).toEqual({
      id: property.id,
      contactId: contact.id,
      contactName: 'Jane Smith',
      archived: false,
    });
    const dup = await req('POST', '/calculator/prospect', {
      countyId,
      taxYear: 2026,
      account: SUBJECT,
      displayName: 'Someone',
    });
    expect(dup.statusCode).toBe(409);
    expect(await t.prisma.contact.count({ where: { orgId } })).toBe(1);

    await t.prisma.property.update({
      where: { id: property.id },
      data: { archivedAt: new Date() },
    });
    expect((await req('GET', estimateUrl())).json().property.archived).toBe(true);
  });

  it('finds an account whose last digit is 9 (prefix range under any collation)', async () => {
    const res = await req(
      'GET',
      `/calculator/search?countyId=${countyId}&taxYear=2026&q=0660640130039`,
    );
    expect(res.json().map((r: { accountNumber: string }) => r.accountNumber)).toEqual([
      '0660640130039',
    ]);
  });

  it('lets read-only members estimate but not create prospects', async () => {
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const c = await login(t.app, 'viewer@example.com');
    expect((await req('GET', estimateUrl(), undefined, c)).statusCode).toBe(200);
    const res = await req(
      'POST',
      '/calculator/prospect',
      { countyId, taxYear: 2026, account: SUBJECT, displayName: 'X' },
      c,
    );
    expect(res.statusCode).toBe(403);
  });

  it('cannot write to the shared roll as the tenant role', async () => {
    const db = t.prisma;
    await expect(
      db.$transaction([
        db.$executeRawUnsafe('SET LOCAL ROLE app_tenant'),
        db.$executeRawUnsafe(`UPDATE "CadParcel" SET "marketValue" = 1`),
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('calculator: browse', () => {
  const browse = (params: string) =>
    req('GET', `/calculator/parcels?countyId=${countyId}&taxYear=2026${params}`);

  beforeEach(async () => {
    // The subject is $150/sq ft of improvement against a $130 neighborhood median.
    await t.prisma
      .$executeRaw`UPDATE "CadParcel" SET "equityIndex" = 1.0 WHERE "countyId" = ${countyId}`;
    await t.prisma.cadParcel.update({
      where: {
        countyId_taxYear_accountNumber: { countyId, taxYear: 2026, accountNumber: SUBJECT },
      },
      data: { equityIndex: '1.1538' },
    });
  });

  it('filters by how far above neighbors, homestead and value, sorted by the index', async () => {
    const res = await browse('&minEquityPct=10&homestead=yes&kind=RESIDENTIAL');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 1,
      items: [
        {
          accountNumber: SUBJECT,
          kind: 'RESIDENTIAL',
          equityPct: 15.4,
          improvementPerSqft: '150.00',
          homestead: true,
        },
      ],
    });
    expect((await browse('&minMarket=500000')).json().total).toBe(0);
    expect((await browse('&maxArea=1950&sort=area&dir=asc')).json().items[0].livingAreaSqft).toBe(
      1900,
    );
  });

  it('pages and sorts; unfiltered totals come from the load', async () => {
    const page1 = (await browse('&pageSize=5&sort=address&dir=asc')).json();
    expect(page1).toMatchObject({ total: 13, page: 1, pageSize: 5 });
    expect(page1.items).toHaveLength(5);
    const page3 = (await browse('&pageSize=5&page=3&sort=address&dir=asc')).json();
    expect(page3.items).toHaveLength(3);
  });

  it('lists building types and grades for the filters', async () => {
    const res = await req('GET', `/calculator/facets?countyId=${countyId}&taxYear=2026`);
    expect(res.json()).toEqual({ propertyUses: [], grades: ['B'] });
  });
});

describe('calculator: commercial accounts', () => {
  const OFFICE = '0010000000099';

  beforeEach(async () => {
    const base = { countyId, taxYear: 2026, stateClass: 'F1', marketArea: '4001' };
    // Subject: 10,000 sq ft office, $200k land, $1.7M market.
    await t.prisma.cadParcel.create({
      data: {
        ...base,
        accountNumber: OFFICE,
        neighborhoodCode: 'C1',
        propertyUse: 'Office Bldgs. Low-Rise (1 to 4 Stories)',
        ownerName: 'ACME HOLDINGS LLC',
        situsLine: '1 COMMERCE ST',
        landValue: '200000',
        improvementValue: '1500000',
        marketValue: '1700000',
        appraisedValue: '1700000',
        livingAreaSqft: 10_000,
        yearBuilt: 1995,
        qualityCode: 'C',
      },
    });
    // 3 offices in its neighborhood, 4 more in other neighborhoods of the market area, all at
    // $120/sq ft of building (→ $1.4M adjusted), and warehouses that must never be used.
    const comp = (i: number, hood: string, use: string) => ({
      ...base,
      accountNumber: `00200000000${String(i).padStart(2, '0')}`,
      neighborhoodCode: hood,
      propertyUse: use,
      situsLine: `${i} MAIN ST`,
      landValue: '150000',
      improvementValue: String(120 * 9_000),
      marketValue: String(150000 + 120 * 9_000),
      appraisedValue: String(150000 + 120 * 9_000),
      livingAreaSqft: 9_000,
      yearBuilt: 2000,
      qualityCode: 'B',
    });
    await t.prisma.cadParcel.createMany({
      data: [
        ...[1, 2, 3].map((i) => comp(i, 'C1', 'Office Bldgs. Low-Rise (1 to 4 Stories)')),
        ...[4, 5, 6, 7].map((i) => comp(i, 'C2', 'Office Bldgs. Low-Rise (1 to 4 Stories)')),
        ...[8, 9, 10, 11, 12].map((i) => comp(i, 'C1', 'Warehouse - Metallic')),
      ],
    });
  });

  it('compares same-type buildings across the market area', async () => {
    const body = (await req('GET', estimateUrl(OFFICE))).json();
    expect(body.parcel).toMatchObject({
      kind: 'COMMERCIAL',
      propertyUse: 'Office Bldgs. Low-Rise (1 to 4 Stories)',
      marketArea: '4001',
    });
    expect(body.estimate).toMatchObject({
      status: 'ESTIMATE',
      confidence: 'LOW',
      widened: true,
      indicatedValue: '1400000.00',
      appraisedReduction: '300000.00',
    });
    expect(body.estimate.comps).toHaveLength(7);
    expect(
      body.estimate.comps.map((c: { accountNumber: string }) => c.accountNumber),
    ).not.toContain('0020000000008');
  });

  it('creates a commercial prospect', async () => {
    const res = await req('POST', '/calculator/prospect', {
      countyId,
      taxYear: 2026,
      account: OFFICE,
      displayName: 'Acme Holdings',
    });
    expect(res.statusCode).toBe(201);
    const property = await t.prisma.property.findUniqueOrThrow({
      where: { id: res.json().propertyId },
    });
    expect(property.propertyType).toBe('COMMERCIAL');
  });
});
