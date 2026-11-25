import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forOrg, scopeArgs, TENANT_MODELS, TenantScopeError } from '../src/index.js';
import { createPrismaClient } from '../src/raw.js';

const prisma = createPrismaClient(process.env.DATABASE_URL!);
let orgA: number;
let orgB: number;
let memberB: number;

beforeAll(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  const [ua, ub] = await Promise.all([
    prisma.user.create({ data: { email: 'a@a.test', name: 'A' } }),
    prisma.user.create({ data: { email: 'b@b.test', name: 'B' } }),
  ]);
  orgA = (await prisma.org.create({ data: { name: 'A', slug: 'a' } })).id;
  orgB = (await prisma.org.create({ data: { name: 'B', slug: 'b' } })).id;
  await prisma.membership.create({ data: { orgId: orgA, userId: ua.id, role: 'OWNER' } });
  memberB = (
    await prisma.membership.create({ data: { orgId: orgB, userId: ub.id, role: 'OWNER' } })
  ).id;
});

afterAll(() => prisma.$disconnect());

describe('forOrg', () => {
  it('only returns rows of its org', async () => {
    const db = forOrg(prisma, orgA);
    const rows = await db.membership.findMany();
    expect(rows.map((r) => r.orgId)).toEqual([orgA]);
    expect(await db.membership.findUnique({ where: { id: memberB } })).toBeNull();
    expect(await db.membership.count()).toBe(1);
  });

  it("can't update or delete another org's rows", async () => {
    const db = forOrg(prisma, orgA);
    const res = await db.membership.updateMany({ where: { id: memberB }, data: { role: 'STAFF' } });
    expect(res.count).toBe(0);
    await expect(
      db.membership.update({ where: { id: memberB }, data: { role: 'STAFF' } }),
    ).rejects.toThrow();
    expect((await db.membership.deleteMany({ where: { id: memberB } })).count).toBe(0);
    const stillB = await prisma.membership.findUniqueOrThrow({ where: { id: memberB } });
    expect(stillB.role).toBe('OWNER');
  });

  it('forces orgId on create, even if the caller passes another org', async () => {
    const db = forOrg(prisma, orgA);
    const row = await db.orgSetting.create({ data: { orgId: orgB, key: 'k', value: 1 } });
    expect(row.orgId).toBe(orgA);
  });

  it('only sees its own org and only users who are its members', async () => {
    const db = forOrg(prisma, orgA);
    expect((await db.org.findMany()).map((o) => o.id)).toEqual([orgA]);
    expect((await db.user.findMany()).map((u) => u.email)).toEqual(['a@a.test']);
  });

  it('refuses platform models and invalid org ids', async () => {
    const db = forOrg(prisma, orgA);
    await expect(db.session.findMany()).rejects.toThrow(TenantScopeError);
    await expect(db.user.update({ where: { id: 1 }, data: { name: 'x' } })).rejects.toThrow(
      TenantScopeError,
    );
    expect(() => forOrg(prisma, 0)).toThrow(TenantScopeError);
  });
});

describe('scopeArgs', () => {
  it('overrides orgId in where, data, upsert and createMany', () => {
    expect(scopeArgs('Membership', 'findMany', { where: { orgId: 9 } }, 1)).toEqual({
      where: { orgId: 1 },
    });
    expect(
      scopeArgs('Membership', 'update', { where: { id: 2 }, data: { orgId: 9, role: 'STAFF' } }, 1),
    ).toEqual({ where: { id: 2, orgId: 1 }, data: { role: 'STAFF' } });
    expect(
      scopeArgs('OrgSetting', 'createMany', { data: [{ key: 'a' }, { key: 'b', orgId: 9 }] }, 1),
    ).toEqual({
      data: [
        { key: 'a', orgId: 1 },
        { key: 'b', orgId: 1 },
      ],
    });
    expect(
      scopeArgs(
        'OrgSetting',
        'upsert',
        { where: { id: 3 }, create: { key: 'a' }, update: { orgId: 9 } },
        1,
      ),
    ).toEqual({ where: { id: 3, orgId: 1 }, create: { key: 'a', orgId: 1 }, update: {} });
    expect(() => scopeArgs('Org', 'delete', {}, 1)).toThrow(TenantScopeError);
  });
});

describe('Postgres RLS backstop', () => {
  /** Runs SQL as the tenant role, the way forOrg does, with an optional org id. */
  async function asTenant<T>(org: number | null, sql: string): Promise<T> {
    const results = await prisma.$transaction([
      prisma.$executeRawUnsafe('SET LOCAL ROLE app_tenant'),
      prisma.$executeRawUnsafe(`SELECT set_config('app.current_org_id', '${org ?? ''}', true)`),
      prisma.$queryRawUnsafe(sql),
    ]);
    return results[2] as T;
  }

  it('filters raw SQL by the current org', async () => {
    const rows = await asTenant<{ orgId: number }[]>(orgA, 'SELECT "orgId" FROM "Membership"');
    expect(rows.map((r) => r.orgId)).toEqual([orgA]);
  });

  it('returns nothing when no org is set', async () => {
    expect(await asTenant<unknown[]>(null, 'SELECT * FROM "Membership"')).toEqual([]);
    expect(await asTenant<unknown[]>(null, 'SELECT * FROM "Org"')).toEqual([]);
  });

  it('rejects writing a row into another org', async () => {
    await expect(
      asTenant(
        orgA,
        `INSERT INTO "OrgSetting" ("orgId","key","value","updatedAt") VALUES (${orgB}, 'x', '1', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps the audit log append-only and platform tables out of reach', async () => {
    await expect(asTenant(orgA, 'DELETE FROM "AuditLog"')).rejects.toThrow(/permission denied/);
    await expect(asTenant(orgA, 'SELECT * FROM "Session"')).rejects.toThrow(/permission denied/);
  });
});

describe('tenant table registry', () => {
  it('every table with an orgId column is in TENANT_MODELS and has RLS with a policy', async () => {
    const rows = await prisma.$queryRaw<{ table: string; rls: boolean; policies: bigint }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS rls,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name
      WHERE col.table_schema = 'public' AND col.column_name = 'orgId'
      ORDER BY 1`;
    expect(rows.map((r) => r.table).sort()).toEqual([...TENANT_MODELS].sort());
    for (const r of rows) {
      expect(r.rls, `${r.table} has RLS enabled`).toBe(true);
      expect(Number(r.policies), `${r.table} has a policy`).toBeGreaterThan(0);
    }
  });
});
