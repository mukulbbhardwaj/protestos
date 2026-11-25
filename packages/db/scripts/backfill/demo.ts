import { hashPassword } from '@app/shared/node';
import type { PrismaClient } from '../../src/raw.js';
import { log } from './common.js';

export const DEMO_PASSWORD = 'demo-password';
export const DEMO_ORG = 'lone-star-demo';
export const GULF_ORG = 'gulf-coast-demo';

/** Demo firms and users in every role. Skips anything that already exists. */
export async function backfillDemoBase(prisma: PrismaClient) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = (email: string, name: string) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, passwordHash, emailVerifiedAt: new Date() },
    });

  const owner = await user('owner@demo.test', 'Olivia Owner');
  // Development only (this step refuses production): the demo owner also gets the platform
  // admin pages (/admin), so one login shows everything.
  await prisma.user.update({ where: { id: owner.id }, data: { isSuperAdmin: true } });
  const admin = await user('admin@demo.test', 'Adam Admin');
  const staff = await user('staff@demo.test', 'Sam Consultant');
  const viewer = await user('viewer@demo.test', 'Vera Viewer');
  const gulfOwner = await user('owner@gulf.test', 'Gus Gulf');
  // Consultants that sample properties are assigned to.
  const consultantNames = [
    ['maria.garcia@demo.test', 'Maria Garcia'],
    ['james.nguyen@demo.test', 'James Nguyen'],
    ['priya.patel@demo.test', 'Priya Patel'],
    ['carlos.ramirez@demo.test', 'Carlos Ramirez'],
    ['emily.chen@demo.test', 'Emily Chen'],
  ] as const;
  const consultants = await Promise.all(consultantNames.map(([e, n]) => user(e, n)));
  const gulfConsultants = await Promise.all(
    [
      ['tina.brooks@gulf.test', 'Tina Brooks'],
      ['ray.okafor@gulf.test', 'Ray Okafor'],
    ].map(([e, n]) => user(e!, n!)),
  );

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const demo = await prisma.org.upsert({
    where: { slug: DEMO_ORG },
    update: {},
    create: {
      name: 'Lone Star Demo Tax Consultants',
      slug: DEMO_ORG,
      phone: '(512) 555-0142',
      website: 'https://example.com',
      addressLines: ['100 Congress Ave, Suite 400', 'Austin, TX 78701'],
      defaultContingencyPct: '30',
      invoicePrefix: 'LS-',
      taxYearDefault: 2026,
      trialEndsAt,
    },
  });
  const gulf = await prisma.org.upsert({
    where: { slug: GULF_ORG },
    update: {},
    create: {
      name: 'Gulf Coast Demo Partners',
      slug: GULF_ORG,
      defaultContingencyPct: '35',
      defaultFlatFee: '75',
      taxYearDefault: 2026,
      trialEndsAt,
    },
  });

  const memberships = [
    { orgId: demo.id, userId: owner.id, role: 'OWNER' as const },
    { orgId: demo.id, userId: admin.id, role: 'ADMIN' as const },
    { orgId: demo.id, userId: staff.id, role: 'STAFF' as const },
    { orgId: demo.id, userId: viewer.id, role: 'READ_ONLY' as const },
    ...consultants.map((c) => ({ orgId: demo.id, userId: c.id, role: 'STAFF' as const })),
    { orgId: gulf.id, userId: gulfOwner.id, role: 'OWNER' as const },
    // The demo owner also belongs to a second firm, to show the org switcher.
    { orgId: gulf.id, userId: owner.id, role: 'ADMIN' as const },
    ...gulfConsultants.map((c) => ({ orgId: gulf.id, userId: c.id, role: 'STAFF' as const })),
  ];
  const added = await prisma.membership.createMany({ data: memberships, skipDuplicates: true });
  log(`demo: firms ${DEMO_ORG}, ${GULF_ORG}; ${added.count} memberships added`);
}
