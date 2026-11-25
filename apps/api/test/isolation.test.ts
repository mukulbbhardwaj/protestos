/**
 * Tenant isolation harness (BUILD_PLAN 6.4). Org A's owner must not be able to see or
 * change anything in org B through any /orgs/:orgSlug route.
 *
 * Every tenant route must have a case below. The "covers every tenant route" test fails
 * when a new route is added without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createUser,
  makeTestApp,
  ownerWithOrg,
  resetDb,
  type TestContext,
} from './helpers.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Target = 'member' | 'invitation' | 'contact' | 'property' | 'taxYear';

interface IsolationCase {
  method: Method;
  /** Path below /orgs/:orgSlug, exactly as registered ('' for the org root). */
  path: string;
  body?: object;
  /** For `:id` routes: which of org B's rows to aim at. */
  targetB?: Target;
}

const CASES: IsolationCase[] = [
  { method: 'GET', path: '' },
  { method: 'GET', path: '/settings' },
  { method: 'PATCH', path: '/settings', body: { name: 'Taken over' } },
  { method: 'GET', path: '/members' },
  { method: 'PATCH', path: '/members/:id', body: { role: 'READ_ONLY' }, targetB: 'member' },
  { method: 'GET', path: '/invitations' },
  { method: 'POST', path: '/invitations', body: { email: 'intruder@alpha.test', role: 'OWNER' } },
  { method: 'POST', path: '/invitations/:id/resend', targetB: 'invitation' },
  { method: 'DELETE', path: '/invitations/:id', targetB: 'invitation' },
  { method: 'GET', path: '/audit-log' },
  { method: 'GET', path: '/finance/summary' },
  { method: 'GET', path: '/contacts' },
  { method: 'GET', path: '/contacts/prospect-counts' },
  { method: 'POST', path: '/contacts', body: { kind: 'CLIENT', displayName: 'Intruder' } },
  { method: 'GET', path: '/contacts/:id', targetB: 'contact' },
  { method: 'PATCH', path: '/contacts/:id', body: { displayName: 'Taken' }, targetB: 'contact' },
  { method: 'POST', path: '/contacts/:id/convert', targetB: 'contact' },
  { method: 'POST', path: '/contacts/:id/archive', targetB: 'contact' },
  { method: 'POST', path: '/contacts/:id/restore', targetB: 'contact' },
  { method: 'GET', path: '/properties' },
  { method: 'POST', path: '/properties', body: { contactId: 1, accountNumber: 'X1', countyId: 1 } },
  { method: 'GET', path: '/properties/:id', targetB: 'property' },
  { method: 'PATCH', path: '/properties/:id', body: { notes: 'Taken' }, targetB: 'property' },
  { method: 'POST', path: '/properties/:id/archive', targetB: 'property' },
  { method: 'POST', path: '/properties/:id/restore', targetB: 'property' },
  {
    method: 'POST',
    path: '/properties/:id/tax-years',
    body: { taxYear: 2030 },
    targetB: 'property',
  },
  { method: 'PATCH', path: '/tax-years/:id', body: { notes: 'Taken' }, targetB: 'taxYear' },
  {
    method: 'POST',
    path: '/tax-years/:id/stage',
    body: { stage: 'WITHDRAWN' },
    targetB: 'taxYear',
  },
  {
    method: 'POST',
    path: '/properties/bulk/assign-consultant',
    body: { ids: [1], consultantUserId: null },
  },
  {
    method: 'POST',
    path: '/properties/bulk/stage',
    body: { ids: [1], taxYear: 2026, stage: 'WITHDRAWN' },
  },
  { method: 'POST', path: '/properties/bulk/rollover', body: { ids: [1], taxYear: 2030 } },
  { method: 'GET', path: '/search?q=bravo' },
  { method: 'GET', path: '/calculator/coverage' },
  { method: 'GET', path: '/calculator/facets?countyId=1&taxYear=2026' },
  { method: 'GET', path: '/calculator/parcels?countyId=1&taxYear=2026' },
  { method: 'GET', path: '/calculator/search?countyId=1&taxYear=2026&q=bravo' },
  { method: 'GET', path: '/calculator/estimate?countyId=1&taxYear=2026&account=SHARED1' },
  {
    method: 'POST',
    path: '/calculator/prospect',
    body: { countyId: 1, taxYear: 2026, account: 'SHARED1', displayName: 'Intruder' },
  },
];

let t: TestContext;
let a: { cookie: string; slug: string; ids: Partial<Record<Target, number>> };
let b: { slug: string; ids: Record<Target, number> };

/** Everything in org B, as raw rows, to prove nothing changed. */
async function snapshotB() {
  const orgB = await t.prisma.org.findUniqueOrThrow({ where: { slug: b.slug } });
  const where = { orgId: orgB.id };
  return JSON.stringify({
    org: orgB,
    members: await t.prisma.membership.findMany({ where, orderBy: { id: 'asc' } }),
    invitations: await t.prisma.invitation.findMany({ where, orderBy: { id: 'asc' } }),
    contacts: await t.prisma.contact.findMany({ where, orderBy: { id: 'asc' } }),
    properties: await t.prisma.property.findMany({ where, orderBy: { id: 'asc' } }),
    taxYears: await t.prisma.taxYearRecord.findMany({ where, orderBy: { id: 'asc' } }),
    stageEvents: await t.prisma.protestStageEvent.count({ where }),
    audit: await t.prisma.auditLog.count({ where }),
  });
}

beforeAll(async () => {
  await resetDb();
  t = await makeTestApp();

  const ownerA = await ownerWithOrg(t.app, 'owner@alpha.test', 'Alpha Org');
  a = { cookie: ownerA.cookie, slug: ownerA.org.slug, ids: {} };

  const ownerB = await ownerWithOrg(t.app, 'owner@bravo.test', 'Bravo Org');
  const staffB = await createUser('staff@bravo.test');
  const memberB = await addMember(ownerB.org.id, staffB.id, 'STAFF');
  const invB = await t.app.inject({
    method: 'POST',
    url: `/orgs/${ownerB.org.slug}/invitations`,
    headers: { cookie: ownerB.cookie },
    payload: { email: 'pending@bravo.test', role: 'STAFF' },
  });
  const county = await t.prisma.county.create({
    data: { state: 'TX', name: 'Shared Test County', cadName: 'Shared CAD' },
  });
  const contactB = await t.prisma.contact.create({
    data: {
      orgId: ownerB.org.id,
      kind: 'CLIENT',
      clientNumber: '9001',
      displayName: 'Bravo Client',
      email: 'client@bravo.test',
    },
  });
  const propertyB = await t.prisma.property.create({
    data: {
      orgId: ownerB.org.id,
      contactId: contactB.id,
      accountNumber: 'BRAVO-1',
      countyId: county.id,
      situsLine: '1 Bravo St',
    },
  });
  // A public roll parcel that org B also has as a property: org A's estimate must not link to it.
  await t.prisma.cadParcel.create({
    data: {
      countyId: county.id,
      taxYear: 2026,
      accountNumber: 'SHARED1',
      stateClass: 'A1',
      neighborhoodCode: 'N1',
      landValue: '1',
      improvementValue: '1',
      marketValue: '2',
      appraisedValue: '2',
    },
  });
  await t.prisma.property.create({
    data: {
      orgId: ownerB.org.id,
      contactId: contactB.id,
      accountNumber: 'SHARED1',
      countyId: county.id,
    },
  });
  const yearB = await t.prisma.taxYearRecord.create({
    data: {
      orgId: ownerB.org.id,
      propertyId: propertyB.id,
      taxYear: 2026,
      noticeAppraised: '100000',
    },
  });
  b = {
    slug: ownerB.org.slug,
    ids: {
      member: memberB.id,
      invitation: invB.json().id,
      contact: contactB.id,
      property: propertyB.id,
      taxYear: yearB.id,
    },
  };
  // Org A gets its own contact and property, for the "own responses" checks on :id routes.
  const contactA = await t.prisma.contact.create({
    data: {
      orgId: ownerA.org.id,
      kind: 'CLIENT',
      clientNumber: '1001',
      displayName: 'Alpha Client',
    },
  });
  const propertyA = await t.prisma.property.create({
    data: {
      orgId: ownerA.org.id,
      contactId: contactA.id,
      accountNumber: 'ALPHA-1',
      countyId: county.id,
    },
  });
  a.ids = { contact: contactA.id, property: propertyA.id };

  // Make the generic bodies above point at org B's rows.
  for (const c of CASES) {
    if (c.path === '/properties' && c.method === 'POST')
      c.body = { contactId: contactB.id, accountNumber: 'X1', countyId: county.id };
    if (c.path.startsWith('/properties/bulk/')) c.body = { ...c.body, ids: [propertyB.id] };
  }

  // Give org A its own rows of every kind too, so list routes have something to return.
  const staffA = await createUser('staff@alpha.test');
  await addMember(ownerA.org.id, staffA.id, 'STAFF');
  await t.app.inject({
    method: 'POST',
    url: `/orgs/${a.slug}/invitations`,
    headers: { cookie: a.cookie },
    payload: { email: 'pending@alpha.test', role: 'STAFF' },
  });
});

afterAll(() => t.app.close());

function url(slug: string, c: IsolationCase, id?: number) {
  return `/orgs/${slug}${c.path.replace(':id', String(id ?? 0))}`;
}
const routeKey = (c: IsolationCase) => `${c.method} ${c.path.split('?')[0]}`;

describe('tenant isolation', () => {
  it('covers every tenant route', () => {
    const registered = new Set(
      t.routes
        .filter((r) => r.url.startsWith('/orgs/:orgSlug') && r.method !== 'HEAD')
        .map((r) => `${r.method} ${r.url.replace('/orgs/:orgSlug', '').replace(/\/$/, '')}`),
    );
    const covered = new Set(CASES.map(routeKey));
    expect([...registered].filter((r) => !covered.has(r))).toEqual([]);
    expect([...covered].filter((c) => !registered.has(c))).toEqual([]);
  });

  describe.each(CASES)('$method $path', (c) => {
    it("returns 404 for another org's slug and changes nothing there", async () => {
      const before = await snapshotB();
      const res = await t.app.inject({
        method: c.method,
        url: url(b.slug, c, c.targetB ? b.ids[c.targetB] : undefined),
        headers: { cookie: a.cookie },
        ...(c.body ? { payload: c.body } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toMatch(/bravo/i);
      expect(await snapshotB()).toBe(before);
    });

    if (c.targetB) {
      it("returns 404 for another org's row id under your own slug", async () => {
        const before = await snapshotB();
        const id = b.ids[c.targetB!];
        const res = await t.app.inject({
          method: c.method,
          url: url(a.slug, c, id),
          headers: { cookie: a.cookie },
          ...(c.body ? { payload: c.body } : {}),
        });
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toMatch(/bravo/i);
        expect(await snapshotB()).toBe(before);
      });
    }

    if (c.method === 'GET') {
      it("never includes another org's data in your own responses", async () => {
        const res = await t.app.inject({
          method: 'GET',
          url: url(a.slug, c, c.targetB ? a.ids[c.targetB] : undefined),
          headers: { cookie: a.cookie },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toMatch(/bravo/i);
      });
    }
  });

  it("can't attach a property to another firm's client, or bulk-edit its properties", async () => {
    const before = await snapshotB();
    const create = await t.app.inject({
      method: 'POST',
      url: `/orgs/${a.slug}/properties`,
      headers: { cookie: a.cookie },
      payload: { contactId: b.ids.contact, accountNumber: 'SNEAKY', countyId: 1 },
    });
    expect(create.statusCode).toBe(404);
    for (const c of CASES.filter((x) => x.path.startsWith('/properties/bulk/'))) {
      const res = await t.app.inject({
        method: c.method,
        url: url(a.slug, c),
        headers: { cookie: a.cookie },
        payload: c.body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(0);
    }
    expect(await snapshotB()).toBe(before);
  });

  it('a logged-out request gets 401, not data', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/orgs/${a.slug}/members` });
    expect(res.statusCode).toBe(401);
  });
});
