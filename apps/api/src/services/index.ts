import { forOrg, type OrgDb } from '@app/db';
import type { MailEvent } from '@app/providers';
import { createAuthService } from './auth.js';
import { applyMailEvents } from './email.js';
import type { ServiceContext } from './context.js';
import { createOrgService } from './orgs.js';
import { createPlatformDataService } from './platform-data.js';

export function createServices(ctx: ServiceContext) {
  const scoped = new Map<number, OrgDb>();
  let counties: Promise<
    { id: number; name: string; cadName: string; cadWebsite: string | null }[]
  > | null = null;
  return {
    reference: {
      /** Reference data changes only with a backfill, so it is cached for the process lifetime. */
      counties() {
        counties ??= ctx.prisma.county.findMany({
          where: { state: 'TX' },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, cadName: true, cadWebsite: true },
        });
        return counties;
      },
    },
    auth: createAuthService(ctx),
    orgs: createOrgService(ctx),
    /** Super-admin only: what data the platform holds (raw access; never for tenant routes). */
    platformData: createPlatformDataService(ctx),
    /** Provider webhook events: found by provider message id, then applied in that org. */
    mailEvents: { apply: (events: MailEvent[]) => applyMailEvents(ctx.prisma, events) },
    /** Calendar feed links: the token finds the membership and its org. */
    calendar: {
      findByToken: (token: string): Promise<{ orgId: number; userId: number } | null> =>
        ctx.prisma.membership.findFirst({
          where: { calendarToken: token, status: 'ACTIVE' },
          select: { orgId: true, userId: true },
        }),
    },
    /** Public signing links: the token finds the envelope and its org. */
    signing: {
      findByToken: (token: string): Promise<{ id: number; orgId: number } | null> =>
        ctx.prisma.signatureEnvelope.findUnique({
          where: { signToken: token },
          select: { id: true, orgId: true },
        }),
    },
    mail: ctx.mail,
    storage: ctx.storage,
    jobs: ctx.jobs,
    config: ctx.config,
    /** Org-scoped data access (forOrg). Cached per org; the extension is stateless. */
    tenantDb(orgId: number): OrgDb {
      let db = scoped.get(orgId);
      if (!db) {
        db = forOrg(ctx.prisma, orgId);
        scoped.set(orgId, db);
      }
      return db;
    },
  };
}

export type Services = ReturnType<typeof createServices>;
