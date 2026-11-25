import type { OrgDb } from '@app/db';
import type { OrgRole } from '@app/shared';
import type { SessionUser } from '../services/auth.js';

export interface TenantContext {
  orgId: number;
  orgSlug: string;
  role: OrgRole;
  userId: number;
  /** The only data access tenant routes use. Scoped to `orgId` (forOrg + RLS). */
  db: OrgDb;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | null;
    tenant: TenantContext | null;
  }
}
