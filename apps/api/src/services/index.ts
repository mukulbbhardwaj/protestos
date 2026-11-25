import { forOrg, type OrgDb } from '@app/db';
import { createAuthService } from './auth.js';
import type { ServiceContext } from './context.js';
import { createOrgService } from './orgs.js';

export function createServices(ctx: ServiceContext) {
  const scoped = new Map<number, OrgDb>();
  return {
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
