import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createUser,
  login,
  makeTestApp,
  PASSWORD,
  resetDb,
  sessionCookie,
  tokenFromMail,
  type TestContext,
} from './helpers.js';

let t: TestContext;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());
beforeEach(resetDb);

const signUp = (email = 'new@example.com') =>
  t.app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { name: 'New Person', email, password: 'a-long-password' },
  });

describe('sign up and email verification', () => {
  it('creates an account, logs in, and emails a verification link', async () => {
    const res = await signUp('  New@Example.com ');
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'new@example.com', emailVerified: false });
    expect(res.json().memberships).toEqual([]);

    const cookie = res.cookies.find((c) => c.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const message = t.mail.lastTo('new@example.com');
    expect(message?.text).toContain(`${APP_URL}/verify-email?token=`);
    expect(JSON.stringify(res.json())).not.toContain('passwordHash');
  });

  it('verifies the email once; the link cannot be reused', async () => {
    const res = await signUp();
    const token = tokenFromMail(t.mail, 'new@example.com');
    const verify = () =>
      t.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } });
    expect((await verify()).statusCode).toBe(200);
    expect((await verify()).json().error.code).toBe('INVALID_TOKEN');

    const me = await t.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: sessionCookie(res) },
    });
    expect(me.json().user.emailVerified).toBe(true);
  });

  it('rejects a duplicate email with a helpful message', async () => {
    await signUp();
    const again = await signUp();
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/already exists/);
  });

  it('validates input with plain messages', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { name: 'X', email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('login and logout', () => {
  it('logs in with the right password only, with the same message for unknown emails', async () => {
    await createUser('a@example.com');
    const ok = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'nope-nope-nope' },
    });
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'nope-nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('logout ends the session', async () => {
    await createUser('a@example.com');
    const cookie = await login(t.app, 'a@example.com');
    expect((await t.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(200);
    await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect((await t.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rejects expired sessions', async () => {
    await createUser('a@example.com');
    const cookie = await login(t.app, 'a@example.com');
    await t.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
    expect(await t.prisma.session.count()).toBe(0);
  });

  it('stores only a hash of the session token', async () => {
    await createUser('a@example.com');
    const cookie = await login(t.app, 'a@example.com');
    const token = cookie.replace('sid=', '');
    const session = await t.prisma.session.findFirstOrThrow();
    expect(session.id).not.toBe(token);
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('password reset', () => {
  it('resets the password and signs out every session', async () => {
    await createUser('a@example.com');
    const oldCookie = await login(t.app, 'a@example.com');

    const forgot = await t.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'a@example.com' },
    });
    expect(forgot.statusCode).toBe(200);
    const token = tokenFromMail(t.mail, 'a@example.com');

    const reset = await t.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'brand-new-password' },
    });
    expect(reset.statusCode).toBe(200);

    expect(
      (await t.app.inject({ url: '/auth/me', headers: { cookie: oldCookie } })).statusCode,
    ).toBe(401);
    const relogin = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'brand-new-password' },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it('does not reveal whether an account exists', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(t.mail.lastTo('nobody@example.com')).toBeUndefined();
  });
});

describe('request hardening', () => {
  it('blocks state-changing requests from another origin', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'a@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BAD_ORIGIN');
  });

  it('rate limits login attempts', async () => {
    const limited = await makeTestApp({ authRateLimitPerMin: 3 });
    const attempt = () =>
      limited.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'x@example.com', password: 'whatever-123' },
      });
    for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    await limited.app.close();
  });

  it('answers unknown routes with JSON', async () => {
    const res = await t.app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
