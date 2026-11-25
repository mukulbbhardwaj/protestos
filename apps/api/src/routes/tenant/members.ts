import { Member, UpdateMemberInput } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import { actorOf, OrgIdParams, OrgParams } from './params.js';

const memberInclude = { user: { select: { id: true, name: true, email: true } } } as const;

function toMember(m: {
  id: number;
  role: Member['role'];
  status: Member['status'];
  createdAt: Date;
  user: { id: number; name: string; email: string };
}): Member {
  return {
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    joinedAt: m.createdAt.toISOString(),
  };
}

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  // Everyone in the org can see the team (consultant pickers need it).
  app.get(
    '/members',
    {
      schema: { params: OrgParams, response: { 200: z.object({ members: z.array(Member) }) } },
    },
    async (request) => {
      const rows = await tenantOf(request).db.membership.findMany({
        include: memberInclude,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });
      return { members: rows.map(toMember) };
    },
  );

  app.patch(
    '/members/:id',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgIdParams, body: UpdateMemberInput, response: { 200: Member } },
    },
    async (request) => {
      const { db, orgId, role: myRole, userId } = tenantOf(request);
      const target = await db.membership.findUnique({
        where: { id: request.params.id },
        include: memberInclude,
      });
      if (!target) throw notFound('That team member was not found.');
      if (target.userId === userId) {
        throw badRequest("You can't change your own role or access. Ask another owner or admin.");
      }
      const nextRole = request.body.role ?? target.role;
      const nextStatus = request.body.status ?? target.status;
      if (myRole !== 'OWNER' && (target.role === 'OWNER' || nextRole === 'OWNER')) {
        throw forbidden('Only an owner can change owners or make someone an owner.');
      }
      const losesOwner =
        target.role === 'OWNER' &&
        target.status === 'ACTIVE' &&
        (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE');
      if (losesOwner) {
        const owners = await db.membership.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
        if (owners <= 1) {
          throw conflict('A firm needs at least one owner. Make someone else an owner first.');
        }
      }

      const updated = await db.membership.update({
        where: { id: target.id },
        data: { role: nextRole, status: nextStatus },
        include: memberInclude,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action:
          nextStatus === 'DISABLED' && target.status !== 'DISABLED'
            ? 'membership.disabled'
            : 'membership.updated',
        entityType: 'Membership',
        entityId: target.id,
        before: { role: target.role, status: target.status },
        after: { role: updated.role, status: updated.status },
      });
      return toMember(updated);
    },
  );
};
