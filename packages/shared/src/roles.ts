export const ORG_ROLES = ['OWNER', 'ADMIN', 'STAFF', 'READ_ONLY'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Higher number = more privilege. SUPER_ADMIN is a platform flag on User, not an org role. */
const RANK: Record<OrgRole, number> = { READ_ONLY: 0, STAFF: 1, ADMIN: 2, OWNER: 3 };

export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return RANK[role] >= RANK[minimum];
}
