// Tenant-safe database entry point. App code uses `forOrg`; the raw client lives in `./raw`.
import type { PrismaClient } from './raw.js';

export { forOrg, scopeArgs, TENANT_MODELS, TenantScopeError, type OrgDb } from './tenant.js';
export type {
  AuthTokenKind,
  MembershipStatus,
  OrgRole,
  Plan,
  PlanStatus,
} from './generated/prisma/enums.js';
export { Prisma } from './generated/prisma/client.js';

/** Liveness check used by /health. Returns true when a trivial query succeeds. */
export async function pingDatabase(client: PrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
