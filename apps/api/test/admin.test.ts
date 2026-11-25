import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, makeTestApp, ownerWithOrg, resetDb, type TestContext } from './helpers.js';

let t: TestContext;
let countyId: number;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDb();
  countyId = (
    await t.prisma.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  const base = {
    countyId,
    taxYear: 2026,
    neighborhoodCode: 'N1',
    landValue: '1',
    appraisedValue: '1',
  };
  await t.prisma.cadParcel.createMany({
    data: [
      {
        ...base,
        accountNumber: '1',
        stateClass: 'A1',
        improvementValue: '100000',
        marketValue: '150000',
        livingAreaSqft: 1500,
        homestead: true,
        units: [{ code: '001', taxableValue: '1' }],
      },
      {
        ...base,
        accountNumber: '2',
        stateClass: 'A1',
        improvementValue: '200000',
        marketValue: '450000',
        livingAreaSqft: null,
        units: [
          { code: '001', taxableValue: '1' },
          { code: '002', taxableValue: '1' },
        ],
      },
      {
        ...base,
        accountNumber: '3',
        stateClass: 'F1',
        improvementValue: '900000',
        marketValue: '2500000',
        livingAreaSqft: 9000,
        propertyUse: 'Warehouse',
        equityIndex: '1.40',
      },
    ],
  });
  await t.prisma.cadTaxUnit.createMany({
    data: [
      { countyId, taxYear: 2026, code: '001', name: 'ISD', kind: 'SCHOOL', ratePct: '1.0' },
      { countyId, taxYear: 2026, code: '002', name: 'MUD 1', kind: 'OTHER', ratePct: null },
    ],
  });
  await t.prisma.cadLoad.create({
    data: { countyId, taxYear: 2026, source: 'test', files: {}, parcelCount: 3, notes: ['A gap'] },
  });
});

describe('platform data (super-admin only)', () => {
  it('is hidden from everyone else', async () => {
    expect((await t.app.inject({ url: '/admin/data/overview' })).statusCode).toBe(401);
    const { cookie } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const res = await t.app.inject({ url: '/admin/data/overview', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    // Even malformed input gets the same 404, not a validation error that reveals the route.
    const bad = await t.app.inject({ url: '/admin/data/counties/abc/1', headers: { cookie } });
    expect(bad.statusCode).toBe(404);
  });

  it('summarizes firms and each loaded roll for a super-admin', async () => {
    const { user } = await ownerWithOrg(t.app, 'admin@example.com', 'Firm');
    await t.prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
    const cookie = await login(t.app, 'admin@example.com');

    const res = await t.app.inject({ url: '/admin/data/overview', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toMatchObject({ firms: 1, users: 1, cadParcels: 3 });
    expect(body.loads).toEqual([
      expect.objectContaining({
        countyName: 'Harris',
        parcels: 3,
        homes: 2,
        commercial: 1,
        notes: ['A gap'],
        missing: expect.objectContaining({ area: 33.3, owner: 100 }),
        homesteadPct: 33.3,
        equityIndexedPct: 33.3,
        taxUnits: 2,
        taxUnitsWithRate: 1,
      }),
    ]);

    const detail = (
      await t.app.inject({ url: `/admin/data/counties/${countyId}/2026`, headers: { cookie } })
    ).json();
    expect(detail).toMatchObject({
      classes: [
        { stateClass: 'A1', count: 2 },
        { stateClass: 'F1', count: 1 },
      ],
      buildingTypes: [{ propertyUse: 'Warehouse', count: 1 }],
      // Three parcel-unit pairs, two of them in the rated ISD.
      rateCoveragePct: 66.7,
    });
    expect(detail.marketValue.find((b: { label: string }) => b.label === '$2M–5M').count).toBe(1);
    expect(detail.equity.find((b: { label: string }) => b.label === '30%+ above').count).toBe(1);
    expect(detail.units[0]).toMatchObject({ code: '001', parcels: 2, ratePct: '1' });

    const missing = await t.app.inject({
      url: '/admin/data/counties/999/2026',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
