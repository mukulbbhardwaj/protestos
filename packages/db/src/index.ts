// Tenant-safe database entry point. The org-scoped `forOrg` layer lands in M1.
import type { PrismaClient } from './raw.js';

export type { OrgRole, MembershipStatus, Plan, PlanStatus } from './generated/prisma/enums.js';

/** Liveness check used by /health. Returns true when a trivial query succeeds. */
export async function pingDatabase(client: PrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
