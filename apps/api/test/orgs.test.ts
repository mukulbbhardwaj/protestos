import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createUser,
  login,
  makeTestApp,
  ownerWithOrg,
  resetDb,
  tokenFromMail,
  type TestContext,
} from './helpers.js';

let t: TestContext;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());
beforeEach(resetDb);

const get = (url: string, cookie: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });
const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('creating an org', () => {
  it('makes the creator OWNER, starts a trial, and audits it', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Lone Star Tax');
    expect(org.slug).toBe('lone-star-tax');

    const me = (await get('/auth/me', cookie)).json();
    expect(me.memberships).toEqual([
      { orgId: org.id, orgSlug: 'lone-star-tax', orgName: 'Lone Star Tax', role: 'OWNER' },
    ]);

    const settings = (await get(`/orgs/${org.slug}/settings`, cookie)).json();
    expect(settings).toMatchObject({ defaultContingencyPct: '30', planStatus: 'TRIALING' });
    expect(new Date(settings.trialEndsAt).getTime()).toBeGreaterThan(Date.now());

    const audit = (await get(`/orgs/${org.slug}/audit-log`, cookie)).json();
    expect(audit.entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['org.created', 'membership.created']),
    );
  });

  it('gives a unique slug when the name is taken', async () => {
    const a = await ownerWithOrg(t.app, 'a@example.com', 'Same Name');
    const b = await ownerWithOrg(t.app, 'b@example.com', 'Same Name');
    expect(a.org.slug).toBe('same-name');
    expect(b.org.slug).toBe('same-name-2');
  });

  it('requires a verified email', async () => {
    await createUser('u@example.com', { verified: false });
    const cookie = await login(t.app, 'u@example.com');
    const res = await send('POST', '/orgs', cookie, { name: 'Firm', defaultContingencyPct: '30' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/Confirm your email/);
  });
});

describe('roles', () => {
  async function orgWith(role: 'ADMIN' | 'STAFF' | 'READ_ONLY') {
    const owner = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const user = await createUser(`${role.toLowerCase()}@example.com`);
    await addMember(owner.org.id, user.id, role);
    return { owner, slug: owner.org.slug, cookie: await login(t.app, user.email) };
  }

  it('STAFF gets 403 on finance and settings, but can see the overview and team', async () => {
    const { slug, cookie } = await orgWith('STAFF');
    expect((await get(`/orgs/${slug}/finance/dashboard`, cookie)).statusCode).toBe(403);
    expect((await get(`/orgs/${slug}/settings`, cookie)).statusCode).toBe(403);
    expect((await send('PATCH', `/orgs/${slug}/settings`, cookie, { name: 'X' })).statusCode).toBe(
      403,
    );
    expect((await get(`/orgs/${slug}/audit-log`, cookie)).statusCode).toBe(403);
    expect((await get(`/orgs/${slug}/invitations`, cookie)).statusCode).toBe(403);
    expect((await get(`/orgs/${slug}`, cookie)).statusCode).toBe(200);
    expect((await get(`/orgs/${slug}/members`, cookie)).statusCode).toBe(200);
  });

  it('ADMIN can use finance and settings', async () => {
    const { slug, cookie } = await orgWith('ADMIN');
    expect((await get(`/orgs/${slug}/finance/dashboard`, cookie)).statusCode).toBe(200);
    expect((await get(`/orgs/${slug}/settings`, cookie)).statusCode).toBe(200);
  });

  it('READ_ONLY cannot change anything', async () => {
    const { slug, cookie } = await orgWith('READ_ONLY');
    const res = await send('POST', `/orgs/${slug}/invitations`, cookie, {
      email: 'x@example.com',
      role: 'STAFF',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/view-only/);
  });

  it('disabled members lose access immediately', async () => {
    const { owner, slug, cookie } = await orgWith('STAFF');
    const members = (await get(`/orgs/${slug}/members`, owner.cookie)).json().members;
    const staff = members.find((m: { role: string }) => m.role === 'STAFF');
    const res = await send('PATCH', `/orgs/${slug}/members/${staff.id}`, owner.cookie, {
      status: 'DISABLED',
    });
    expect(res.statusCode).toBe(200);
    expect((await get(`/orgs/${slug}`, cookie)).statusCode).toBe(404);
  });
});

describe('settings', () => {
  it('updates settings and records a before/after diff of changed fields only', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const res = await send('PATCH', `/orgs/${org.slug}/settings`, cookie, {
      phone: '(512) 555-0100',
      defaultContingencyPct: '32.5',
      invoiceDueDays: 30,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ phone: '(512) 555-0100', defaultContingencyPct: '32.5' });

    const [entry] = (await get(`/orgs/${org.slug}/audit-log`, cookie)).json().entries;
    expect(entry.action).toBe('settings.updated');
    expect(entry.before).toEqual({ phone: null, defaultContingencyPct: '30' });
    expect(entry.after).toEqual({ phone: '(512) 555-0100', defaultContingencyPct: '32.5' });
  });

  it('rejects a contingency over 100%', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const res = await send('PATCH', `/orgs/${org.slug}/settings`, cookie, {
      defaultContingencyPct: '120',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('members', () => {
  it('owners can demote another owner; admins cannot touch owners', async () => {
    const { cookie, org, user } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const second = await createUser('owner2@example.com');
    const secondMember = await addMember(org.id, second.id, 'OWNER');
    const secondCookie = await login(t.app, 'owner2@example.com');
    const firstMember = await t.prisma.membership.findFirstOrThrow({ where: { userId: user.id } });

    const demote = await send(
      'PATCH',
      `/orgs/${org.slug}/members/${firstMember.id}`,
      secondCookie,
      {
        role: 'ADMIN',
      },
    );
    expect(demote.statusCode).toBe(200);
    expect(demote.json().role).toBe('ADMIN');

    // The first user is now an admin and can no longer change the remaining owner.
    const res = await send('PATCH', `/orgs/${org.slug}/members/${secondMember.id}`, cookie, {
      status: 'DISABLED',
    });
    expect(res.statusCode).toBe(403);
  });

  it("doesn't let you change your own role", async () => {
    const { cookie, org, user } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const mine = await t.prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    const res = await send('PATCH', `/orgs/${org.slug}/members/${mine.id}`, cookie, {
      role: 'STAFF',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('invitations', () => {
  it('invites by email; the invitee signs up and joins with the invited role', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const created = await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
      email: 'Staff@Example.com',
      role: 'STAFF',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'staff@example.com', status: 'PENDING' });

    const token = tokenFromMail(t.mail, 'staff@example.com');
    const preview = await t.app.inject({ url: `/invitations/${token}` });
    expect(preview.json()).toEqual({
      orgName: 'Firm',
      email: 'staff@example.com',
      role: 'STAFF',
      status: 'PENDING',
    });

    const signup = await t.app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { name: 'Staff', email: 'staff@example.com', password: 'a-long-password' },
    });
    const staffCookie = `sid=${signup.cookies.find((c) => c.name === 'sid')!.value}`;
    const accept = await send('POST', `/invitations/${token}/accept`, staffCookie);
    expect(accept.json()).toEqual({ orgSlug: org.slug });

    const me = (await get('/auth/me', staffCookie)).json();
    expect(me.user.emailVerified).toBe(true);
    expect(me.memberships[0]).toMatchObject({ orgSlug: org.slug, role: 'STAFF' });

    const again = await send('POST', `/invitations/${token}/accept`, staffCookie);
    expect(again.statusCode).toBe(409);
  });

  it('only the invited email can accept', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
      email: 'right@example.com',
      role: 'STAFF',
    });
    const token = tokenFromMail(t.mail, 'right@example.com');
    await createUser('wrong@example.com');
    const res = await send(
      'POST',
      `/invitations/${token}/accept`,
      await login(t.app, 'wrong@example.com'),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('right@example.com');
  });

  it('revoked and expired invitations cannot be accepted', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const inv = (
      await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
        email: 'x@example.com',
        role: 'STAFF',
      })
    ).json();
    const token = tokenFromMail(t.mail, 'x@example.com');
    await createUser('x@example.com');
    const xCookie = await login(t.app, 'x@example.com');

    await send('DELETE', `/orgs/${org.slug}/invitations/${inv.id}`, cookie);
    expect((await send('POST', `/invitations/${token}/accept`, xCookie)).statusCode).toBe(409);

    await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
      email: 'x@example.com',
      role: 'STAFF',
    });
    const token2 = tokenFromMail(t.mail, 'x@example.com');
    await t.prisma.invitation.updateMany({
      where: { revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await send('POST', `/invitations/${token2}/accept`, xCookie)).statusCode).toBe(409);
  });

  it("won't invite an existing member, and only owners can invite owners", async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const dupe = await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
      email: 'owner@example.com',
      role: 'STAFF',
    });
    expect(dupe.statusCode).toBe(409);

    const admin = await createUser('admin@example.com');
    await addMember(org.id, admin.id, 'ADMIN');
    const res = await send(
      'POST',
      `/orgs/${org.slug}/invitations`,
      await login(t.app, 'admin@example.com'),
      {
        email: 'boss@example.com',
        role: 'OWNER',
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('resending replaces the link', async () => {
    const { cookie, org } = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
    const inv = (
      await send('POST', `/orgs/${org.slug}/invitations`, cookie, {
        email: 'x@example.com',
        role: 'STAFF',
      })
    ).json();
    const first = tokenFromMail(t.mail, 'x@example.com');
    await send('POST', `/orgs/${org.slug}/invitations/${inv.id}/resend`, cookie);
    const second = tokenFromMail(t.mail, 'x@example.com');
    expect(second).not.toBe(first);
    expect((await t.app.inject({ url: `/invitations/${first}` })).statusCode).toBe(404);
  });
});
