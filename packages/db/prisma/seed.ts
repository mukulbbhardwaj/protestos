// Local demo data: `pnpm db:seed`. Safe to re-run (skips if the demo org exists).
// Every login below uses the password DEMO_PASSWORD. Development only.
import { existsSync } from 'node:fs';
import { hashPassword } from '@app/shared/node';
import { createPrismaClient } from '../src/raw.js';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing to seed demo data in production.');

const DEMO_PASSWORD = 'demo-password';
const prisma = createPrismaClient(process.env.DATABASE_URL!);

async function main() {
  if (await prisma.org.findUnique({ where: { slug: 'lone-star-demo' } })) {
    console.log('Demo data already present. Log in as owner@demo.test.');
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash, emailVerifiedAt: new Date() } });

  const owner = await user('owner@demo.test', 'Olivia Owner');
  const admin = await user('admin@demo.test', 'Adam Admin');
  const staff = await user('staff@demo.test', 'Sam Consultant');
  const viewer = await user('viewer@demo.test', 'Vera Viewer');
  const otherOwner = await user('owner@gulf.test', 'Gus Gulf');

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const demo = await prisma.org.create({
    data: {
      name: 'Lone Star Demo Tax Consultants',
      slug: 'lone-star-demo',
      phone: '(512) 555-0142',
      website: 'https://example.com',
      addressLines: ['100 Congress Ave, Suite 400', 'Austin, TX 78701'],
      defaultContingencyPct: '30',
      defaultFlatFee: '0',
      invoicePrefix: 'LS-',
      trialEndsAt,
    },
  });
  const gulf = await prisma.org.create({
    data: {
      name: 'Gulf Coast Demo Partners',
      slug: 'gulf-coast-demo',
      defaultContingencyPct: '35',
      trialEndsAt,
    },
  });

  await prisma.membership.createMany({
    data: [
      { orgId: demo.id, userId: owner.id, role: 'OWNER' },
      { orgId: demo.id, userId: admin.id, role: 'ADMIN' },
      { orgId: demo.id, userId: staff.id, role: 'STAFF' },
      { orgId: demo.id, userId: viewer.id, role: 'READ_ONLY' },
      { orgId: gulf.id, userId: otherOwner.id, role: 'OWNER' },
      // The demo owner also belongs to a second firm, to show the org switcher.
      { orgId: gulf.id, userId: owner.id, role: 'ADMIN' },
    ],
  });
  await prisma.auditLog.createMany({
    data: [
      {
        orgId: demo.id,
        actorUserId: owner.id,
        action: 'org.created',
        entityType: 'Org',
        entityId: String(demo.id),
        after: { name: demo.name },
      },
      {
        orgId: gulf.id,
        actorUserId: otherOwner.id,
        action: 'org.created',
        entityType: 'Org',
        entityId: String(gulf.id),
        after: { name: gulf.name },
      },
    ],
  });

  console.log(`Seeded demo data. Log in at http://localhost:5173/login with password "${DEMO_PASSWORD}":
  owner@demo.test   OWNER of Lone Star Demo (and ADMIN of Gulf Coast Demo)
  admin@demo.test   ADMIN
  staff@demo.test   STAFF
  viewer@demo.test  READ_ONLY`);
}

await main();
await prisma.$disconnect();
