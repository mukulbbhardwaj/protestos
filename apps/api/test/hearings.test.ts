import { SAMPLE_CSVS, zonedToUtc } from '@app/shared';
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
let ownerId: number;
let harris: number;
let fortBend: number;

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
  ownerId = (await t.prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } })).id;
  harris = (
    await t.prisma.county.create({ data: { state: 'TX', name: 'Harris', cadName: 'Harris CAD' } })
  ).id;
  fortBend = (
    await t.prisma.county.create({
      data: { state: 'TX', name: 'Fort Bend', cadName: 'Fort Bend CAD' },
    })
  ).id;
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

async function property(countyId = harris, account = '0660640130020') {
  const c = (
    await req('POST', '/contacts', { kind: 'CLIENT', displayName: `Owner ${account}` })
  ).json();
  const p = await req('POST', '/properties', {
    contactId: c.id,
    accountNumber: account,
    countyId,
    taxYear: 2026,
  });
  expect(p.statusCode).toBe(201);
  return p.json() as { id: number; taxYears: { id: number }[] };
}

const stage = async (yearId: number) =>
  (await t.prisma.taxYearRecord.findUniqueOrThrow({ where: { id: yearId } })).protestStage;

describe('hearings', () => {
  it('schedules, moves the stage, filters, updates and deletes', async () => {
    const p = await property();
    const at = '2026-06-15T14:30:00.000Z';
    const res = await req('POST', '/hearings', {
      propertyId: p.id,
      taxYear: 2026,
      scheduledAt: at,
      type: 'ARB',
      location: 'HCAD',
      panel: '12',
      assignedUserId: ownerId,
    });
    expect(res.statusCode).toBe(201);
    const h = res.json();
    expect(h).toMatchObject({ scheduledAt: at, status: 'SCHEDULED', assignedTo: { id: ownerId } });
    expect(await stage(p.taxYears[0]!.id)).toBe('HEARING_SCHEDULED');

    const june = (
      await req('GET', '/hearings?from=2026-06-01T05:00:00Z&to=2026-07-01T05:00:00Z')
    ).json();
    expect(june.total).toBe(1);
    expect((await req('GET', '/hearings?from=2026-07-01T05:00:00Z')).json().total).toBe(0);
    expect((await req('GET', `/hearings?countyId=${fortBend}`)).json().total).toBe(0);
    expect((await req('GET', `/hearings?consultantId=${ownerId}`)).json().total).toBe(1);

    const done = (
      await req('PATCH', `/hearings/${h.id}`, { status: 'ATTENDED', notes: 'Settled at the table' })
    ).json();
    expect(done).toMatchObject({ status: 'ATTENDED', notes: 'Settled at the table' });
    expect((await req('DELETE', `/hearings/${h.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/hearings/${h.id}`)).statusCode).toBe(404);
    expect((await req('GET', '/hearings')).json().total).toBe(0);
    const actions = (await t.prisma.auditLog.findMany({ where: { entityType: 'Hearing' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['hearing.created', 'hearing.updated', 'hearing.deleted']);
  });

  it('imports a CAD schedule in Central time, idempotently, and reschedules on change', async () => {
    await property(harris, '0660640130020');
    await property(fortBend, 'R267426');
    const run = async (csv: string) => {
      const up = await t.app.inject({
        method: 'POST',
        url: `/orgs/${slug}/imports?kind=HEARINGS&fileName=schedule.csv`,
        headers: { cookie, 'content-type': 'text/csv' },
        payload: csv,
      });
      expect(up.statusCode).toBe(201);
      const id = up.json().id;
      await req('POST', `/imports/${id}/preview`);
      await req('POST', `/imports/${id}/run`);
      return (await req('GET', `/imports/${id}`)).json();
    };
    expect((await run(SAMPLE_CSVS.HEARINGS)).summary).toEqual({
      CREATE: 2,
      UPDATE: 0,
      UNCHANGED: 0,
      ERROR: 0,
    });
    const list = (await req('GET', '/hearings')).json();
    expect(
      list.items.map(
        (h: { scheduledAt: string; type: string; panel: string | null }) =>
          `${h.scheduledAt} ${h.type} ${h.panel}`,
      ),
    ).toEqual(['2026-06-15T14:30:00.000Z ARB Panel 12', '2026-06-16T18:00:00.000Z INFORMAL null']);
    expect((await run(SAMPLE_CSVS.HEARINGS)).summary).toMatchObject({ UNCHANGED: 2 });
    const moved = await run(SAMPLE_CSVS.HEARINGS.replace('9:30 AM', '2:15 PM'));
    expect(moved.summary).toMatchObject({ UPDATE: 1, UNCHANGED: 1 });
    expect((await req('GET', '/hearings')).json().items[0].scheduledAt).toBe(
      zonedToUtc('2026-06-15', '14:15').toISOString(),
    );
  });

  it('gives each member a private calendar feed of their hearings, and can rotate it', async () => {
    const p = await property();
    await req('POST', '/hearings', {
      propertyId: p.id,
      taxYear: 2026,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      assignedUserId: ownerId,
      location: 'HCAD, Room 4',
    });
    await req('POST', '/hearings', {
      propertyId: p.id,
      taxYear: 2026,
      type: 'INFORMAL',
      scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    const { url } = (await req('GET', '/calendar-feed')).json();
    expect((await req('GET', '/calendar-feed')).json().url).toBe(url);
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const feed = await t.app.inject({ method: 'GET', url: path });
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(feed.body).toContain('SUMMARY:ARB hearing: Owner 0660640130020 (Harris 0660640130020)');
    expect(feed.body).toContain('LOCATION:HCAD\\, Room 4');

    const rotated = (await req('POST', '/calendar-feed/rotate')).json().url;
    expect(rotated).not.toBe(url);
    expect((await t.app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    expect(
      (await t.app.inject({ method: 'GET', url: '/calendar/not-a-real-token-xxxxxxxx.ics' }))
        .statusCode,
    ).toBe(404);
  });

  it('counts hearings today and this week on the dashboard; read-only can view', async () => {
    const p = await property();
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
    await req('POST', '/hearings', {
      propertyId: p.id,
      taxYear: 2026,
      scheduledAt: zonedToUtc(today, '23:30').toISOString(),
    });
    await req('POST', '/hearings', {
      propertyId: p.id,
      taxYear: 2026,
      type: 'INFORMAL',
      scheduledAt: new Date(zonedToUtc(today, '12:00').getTime() + 3 * 86_400_000).toISOString(),
    });
    const stats = (await req('GET', '')).json().stats;
    expect(stats).toMatchObject({ hearingsToday: 1, hearingsThisWeek: 2 });
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const vc = await login(t.app, 'viewer@example.com');
    expect((await req('GET', '/hearings', undefined, vc)).statusCode).toBe(200);
    expect(
      (
        await req(
          'POST',
          '/hearings',
          { propertyId: p.id, taxYear: 2026, scheduledAt: now.toISOString() },
          vc,
        )
      ).statusCode,
    ).toBe(403);
  });
});
