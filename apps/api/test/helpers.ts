import { createPrismaClient, type PrismaClient } from '@app/db/raw';
import { forOrg } from '@app/db';
import { applyImport } from '@app/imports';
import { MemoryMailProvider, MemoryStorageProvider } from '@app/providers';
import { InlineQueue, JOBS } from '../src/jobs.js';
import type { OrgRole } from '@app/shared';
import { hashPassword } from '@app/shared/node';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp, type App, type AppDeps } from '../src/app.js';

export const APP_URL = 'http://localhost:5173';
export const PASSWORD = 'test-password-123';

let prisma: PrismaClient | undefined;
let passwordHash: string | undefined;

export function testPrisma(): PrismaClient {
  prisma ??= createPrismaClient(process.env.DATABASE_URL!);
  return prisma;
}

export interface TestContext {
  app: App;
  prisma: PrismaClient;
  mail: MemoryMailProvider;
  storage: MemoryStorageProvider;
  jobs: InlineQueue;
  routes: { method: string; url: string }[];
}

export async function makeTestApp(overrides: Partial<AppDeps> = {}): Promise<TestContext> {
  const mail = new MemoryMailProvider();
  const storage = new MemoryStorageProvider();
  // Background jobs run inline, against the same code the worker uses.
  const jobs = new InlineQueue({
    [JOBS.importRun]: (d: { orgId: number; jobId: number; actorUserId: number | null }) =>
      applyImport(
        { db: forOrg(testPrisma(), d.orgId), orgId: d.orgId, actorUserId: d.actorUserId },
        storage,
        d.jobId,
      ),
  });
  const routes: { method: string; url: string }[] = [];
  const app = await buildApp(
    {
      prisma: testPrisma(),
      mail,
      storage,
      jobs,
      appUrl: APP_URL,
      version: 'test',
      authRateLimitPerMin: 10_000,
      ...overrides,
    },
    {
      onRoute: (r) => {
        for (const method of [r.method].flat()) routes.push({ method, url: r.url });
      },
    },
  );
  await app.ready();
  return { app, prisma: testPrisma(), mail, storage, jobs, routes };
}

/** Empties every application table. Only ever points at TEST_DATABASE_URL (see setup.ts). */
export async function resetDb(): Promise<void> {
  const db = testPrisma();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function createUser(email: string, opts: { name?: string; verified?: boolean } = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  return testPrisma().user.create({
    data: {
      email,
      name: opts.name ?? email.split('@')[0]!,
      passwordHash,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
}

/** The `sid` cookie from a response, ready to send back as a Cookie header. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error(`No session cookie in response (status ${res.statusCode})`);
  return `sid=${cookie.value}`;
}

export async function login(app: App, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  return sessionCookie(res);
}

export async function createOrgViaApi(app: App, cookie: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { cookie },
    payload: { name, defaultContingencyPct: '30' },
  });
  if (res.statusCode !== 201) throw new Error(`create org failed: ${res.body}`);
  return res.json() as { id: number; slug: string; name: string };
}

export async function addMember(orgId: number, userId: number, role: OrgRole) {
  return testPrisma().membership.create({ data: { orgId, userId, role } });
}

/** A verified user who owns a fresh org, logged in. */
export async function ownerWithOrg(app: App, email: string, orgName: string) {
  const user = await createUser(email);
  const cookie = await login(app, email);
  const org = await createOrgViaApi(app, cookie, orgName);
  return { user, cookie, org };
}

/** Pulls the token out of the newest emailed link to `to` matching `/path?token=` or `/path/`. */
export function tokenFromMail(mail: MemoryMailProvider, to: string): string {
  const message = mail.lastTo(to);
  const match = message?.text.match(/(?:token=|\/invite\/)([A-Za-z0-9_-]{20,})/);
  if (!match?.[1]) throw new Error(`No token in mail to ${to}`);
  return match[1];
}
