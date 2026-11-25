import type { OrgDb } from '@app/db';

export interface AuditActor {
  userId: number | null;
  ip: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}

/** JSON-safe copy (Decimal, Date and BigInt become strings). */
export function toAuditJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/** Keeps only the fields that changed, so the log shows a readable diff. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const was = toAuditJson(before[key]);
    const now = toAuditJson(after[key]);
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      b[key] = was;
      a[key] = now;
    }
  }
  return { before: b, after: a };
}

/** Appends an AuditLog row in the caller's org (BUILD_PLAN 6.9). */
export async function recordAudit(
  db: OrgDb,
  orgId: number,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      orgId,
      actorUserId: actor.userId,
      ip: actor.ip,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      before: toAuditJson(entry.before) ?? undefined,
      after: toAuditJson(entry.after) ?? undefined,
    },
  });
}
