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

interface IsolationCase {
  method: Method;
  /** Path below /orgs/:orgSlug, exactly as registered ('' for the org root). */
  path: string;
  body?: object;
  /** For `:id` routes: which of org B's rows to aim at. */
  targetB?: 'member' | 'invitation';
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
];

let t: TestContext;
let a: { cookie: string; slug: string };
let b: { slug: string; memberId: number; invitationId: number };

/** Everything in org B, as raw rows, to prove nothing changed. */
async function snapshotB() {
  const orgB = await t.prisma.org.findUniqueOrThrow({ where: { slug: b.slug } });
  const where = { orgId: orgB.id };
  return JSON.stringify({
    org: orgB,
    members: await t.prisma.membership.findMany({ where, orderBy: { id: 'asc' } }),
    invitations: await t.prisma.invitation.findMany({ where, orderBy: { id: 'asc' } }),
    audit: await t.prisma.auditLog.count({ where }),
  });
}

beforeAll(async () => {
  await resetDb();
  t = await makeTestApp();

  const ownerA = await ownerWithOrg(t.app, 'owner@alpha.test', 'Alpha Org');
  a = { cookie: ownerA.cookie, slug: ownerA.org.slug };

  const ownerB = await ownerWithOrg(t.app, 'owner@bravo.test', 'Bravo Org');
  const staffB = await createUser('staff@bravo.test');
  const memberB = await addMember(ownerB.org.id, staffB.id, 'STAFF');
  const invB = await t.app.inject({
    method: 'POST',
    url: `/orgs/${ownerB.org.slug}/invitations`,
    headers: { cookie: ownerB.cookie },
    payload: { email: 'pending@bravo.test', role: 'STAFF' },
  });
  b = { slug: ownerB.org.slug, memberId: memberB.id, invitationId: invB.json().id };

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

describe('tenant isolation', () => {
  it('covers every tenant route', () => {
    const registered = new Set(
      t.routes
        .filter((r) => r.url.startsWith('/orgs/:orgSlug') && r.method !== 'HEAD')
        .map((r) => `${r.method} ${r.url.replace('/orgs/:orgSlug', '').replace(/\/$/, '')}`),
    );
    const covered = new Set(CASES.map((c) => `${c.method} ${c.path}`));
    expect([...registered].filter((r) => !covered.has(r))).toEqual([]);
    expect([...covered].filter((c) => !registered.has(c))).toEqual([]);
  });

  describe.each(CASES)('$method $path', (c) => {
    it("returns 404 for another org's slug and changes nothing there", async () => {
      const before = await snapshotB();
      const res = await t.app.inject({
        method: c.method,
        url: url(b.slug, c, c.targetB === 'member' ? b.memberId : b.invitationId),
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
        const id = c.targetB === 'member' ? b.memberId : b.invitationId;
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
          url: url(a.slug, c),
          headers: { cookie: a.cookie },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toMatch(/bravo/i);
      });
    }
  });

  it('a logged-out request gets 401, not data', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/orgs/${a.slug}/members` });
    expect(res.statusCode).toBe(401);
  });
});
