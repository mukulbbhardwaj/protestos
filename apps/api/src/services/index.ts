import { forOrg, type OrgDb } from '@app/db';
import { createAuthService } from './auth.js';
import type { ServiceContext } from './context.js';
import { createOrgService } from './orgs.js';

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
    mail: ctx.mail,
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
