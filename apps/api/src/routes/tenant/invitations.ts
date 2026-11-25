import { CreateInvitationInput, Invitation } from '@app/shared';
import { generateToken, hashToken } from '@app/shared/node';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as emails from '../../emails.js';
import { conflict, forbidden, notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import type { Services } from '../../services/index.js';
import { invitationStatus } from '../../services/orgs.js';
import { actorOf, Ok, OrgIdParams, OrgParams } from './params.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toInvitation(inv: {
  id: number;
  email: string;
  role: Invitation['role'];
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: { name: string } | null;
}): Invitation {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: invitationStatus(inv),
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy?.name ?? null,
  };
}

const include = { invitedBy: { select: { name: true } } } as const;

export const invitationRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (
  app,
  { services },
) => {
  const admin = requireRole('ADMIN');

  async function sendInvite(
    request: Parameters<typeof tenantOf>[0],
    inv: { email: string; role: string },
    token: string,
  ) {
    const { db, orgId } = tenantOf(request);
    const org = await db.org.findFirstOrThrow({ select: { name: true } });
    await services.mail.send(
      emails.invitation(
        inv.email,
        orgId,
        org.name,
        request.user?.name ?? 'A teammate',
        inv.role,
        `${services.config.appUrl}/invite/${token}`,
      ),
    );
  }

  app.get(
    '/invitations',
    {
      preValidation: admin,
      schema: {
        params: OrgParams,
        response: { 200: z.object({ invitations: z.array(Invitation) }) },
      },
    },
    async (request) => {
      const rows = await tenantOf(request).db.invitation.findMany({
        include,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { invitations: rows.map(toInvitation) };
    },
  );

  app.post(
    '/invitations',
    {
      preValidation: admin,
      schema: { params: OrgParams, body: CreateInvitationInput, response: { 201: Invitation } },
    },
    async (request, reply) => {
      const { db, orgId, role, userId } = tenantOf(request);
      const { email } = request.body;
      if (request.body.role === 'OWNER' && role !== 'OWNER') {
        throw forbidden('Only an owner can invite another owner.');
      }
      const member = await db.membership.findFirst({
        where: { status: 'ACTIVE', user: { email } },
        select: { id: true },
      });
      if (member) throw conflict(`${email} is already on your team.`, 'ALREADY_MEMBER');

      // A new invitation replaces any pending one for the same email.
      await db.invitation.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = generateToken();
      const inv = await db.invitation.create({
        data: {
          orgId,
          email,
          role: request.body.role,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: userId,
        },
        include,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invitation.created',
        entityType: 'Invitation',
        entityId: inv.id,
        after: { email, role: inv.role },
      });
      await sendInvite(request, inv, token);
      return reply.code(201).send(toInvitation(inv));
    },
  );

  app.post(
    '/invitations/:id/resend',
    { preValidation: admin, schema: { params: OrgIdParams, response: { 200: Invitation } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const existing = await db.invitation.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('That invitation was not found.');
      if (existing.acceptedAt || existing.revokedAt) {
        throw conflict('This invitation is no longer pending. Send a new one instead.');
      }
      const token = generateToken();
      const inv = await db.invitation.update({
        where: { id: existing.id },
        data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
        include,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'invitation.resent',
        entityType: 'Invitation',
        entityId: inv.id,
      });
      await sendInvite(request, inv, token);
      return toInvitation(inv);
    },
  );

  app.delete(
    '/invitations/:id',
    { preValidation: admin, schema: { params: OrgIdParams, response: { 200: Ok } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const existing = await db.invitation.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('That invitation was not found.');
      if (!existing.acceptedAt && !existing.revokedAt) {
        await db.invitation.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
        await recordAudit(db, orgId, actorOf(request), {
          action: 'invitation.revoked',
          entityType: 'Invitation',
          entityId: existing.id,
          before: { email: existing.email, role: existing.role },
        });
      }
      return { ok: true as const };
    },
  );
};
