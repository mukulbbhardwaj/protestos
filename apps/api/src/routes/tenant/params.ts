import { Id } from '@app/shared';
import { z } from 'zod';

export const OrgParams = z.object({ orgSlug: z.string() });
export const OrgIdParams = OrgParams.extend({ id: Id });
export const Ok = z.object({ ok: z.literal(true) });

/** Who did it, for AuditLog rows. */
export function actorOf(request: { tenant: { userId: number } | null; ip: string }) {
  return { userId: request.tenant?.userId ?? null, ip: request.ip ?? null };
}
