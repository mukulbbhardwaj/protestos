import type { OrgRole } from '@app/shared';
import { hashToken } from '@app/shared/node';
import { conflict, forbidden, notFound } from '../errors.js';
import { toAuditJson } from './audit.js';
import type { SessionUser } from './auth.js';
import type { ServiceContext } from './context.js';

const TRIAL_DAYS = 14; // BUILD_PLAN 8.1 [ASK]: placeholder until pricing is settled (M9).
const DAY_MS = 24 * 60 * 60 * 1000;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'firm';
}

// Slugs that would collide with top-level web routes.
const RESERVED_SLUGS = new Set([
  'login',
  'signup',
  'logout',
  'onboarding',
  'verify-email',
  'forgot-password',
  'reset-password',
  'invite',
  'admin',
  'api',
  'dev',
  'settings',
  'app',
]);

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export function invitationStatus(inv: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt < new Date()) return 'EXPIRED';
  return 'PENDING';
}

export interface TenantMembership {
  orgId: number;
  orgSlug: string;
  role: OrgRole;
}

export function createOrgService(ctx: ServiceContext) {
  const { prisma } = ctx;

  async function uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      if (RESERVED_SLUGS.has(candidate)) continue;
      const taken = await prisma.org.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  return {
    async createOrg(
      user: SessionUser,
      input: { name: string; defaultContingencyPct: string },
      ip: string | null,
    ) {
      if (!user.emailVerifiedAt) {
        throw forbidden('Confirm your email address before creating a firm.');
      }
      const slug = await uniqueSlug(input.name);
      return prisma.$transaction(async (tx) => {
        const org = await tx.org.create({
          data: {
            name: input.name,
            slug,
            defaultContingencyPct: input.defaultContingencyPct,
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
          },
        });
        const membership = await tx.membership.create({
          data: { orgId: org.id, userId: user.id, role: 'OWNER' },
        });
        await tx.auditLog.createMany({
          data: [
            {
              orgId: org.id,
              actorUserId: user.id,
              ip,
              action: 'org.created',
              entityType: 'Org',
              entityId: String(org.id),
              after: toAuditJson({ name: org.name, slug: org.slug }) as object,
            },
            {
              orgId: org.id,
              actorUserId: user.id,
              ip,
              action: 'membership.created',
              entityType: 'Membership',
              entityId: String(membership.id),
              after: { userId: user.id, role: 'OWNER' },
            },
          ],
        });
        return { id: org.id, slug: org.slug, name: org.name };
      });
    },

    /**
     * Resolves the org in the URL for this user. Unknown orgs and orgs the user doesn't
     * belong to both return null, so the API can't be used to probe which slugs exist.
     */
    async resolveMembership(userId: number, orgSlug: string): Promise<TenantMembership | null> {
      const membership = await prisma.membership.findFirst({
        where: { userId, status: 'ACTIVE', org: { slug: orgSlug } },
        select: { orgId: true, role: true, org: { select: { slug: true } } },
      });
      return membership
        ? { orgId: membership.orgId, orgSlug: membership.org.slug, role: membership.role }
        : null;
    },

    async previewInvitation(token: string) {
      const inv = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { org: { select: { name: true } } },
      });
      if (!inv) throw notFound('This invitation link is not valid. Ask for a new one.');
      return {
        orgName: inv.org.name,
        email: inv.email,
        role: inv.role,
        status: invitationStatus(inv),
      };
    },

    async acceptInvitation(user: SessionUser, token: string, ip: string | null) {
      const inv = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { org: { select: { slug: true } } },
      });
      if (!inv) throw notFound('This invitation link is not valid. Ask for a new one.');
      const status = invitationStatus(inv);
      if (status !== 'PENDING') {
        throw conflict(
          status === 'ACCEPTED'
            ? 'This invitation was already accepted.'
            : 'This invitation is no longer valid. Ask the person who invited you for a new one.',
          `INVITATION_${status}`,
        );
      }
      if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
        throw forbidden(
          `This invitation was sent to ${inv.email}. Log in with that email address to accept it.`,
        );
      }

      await prisma.$transaction(async (tx) => {
        const existing = await tx.membership.findUnique({
          where: { orgId_userId: { orgId: inv.orgId, userId: user.id } },
        });
        const membership = existing
          ? await tx.membership.update({
              where: { id: existing.id },
              data: { role: inv.role, status: 'ACTIVE' },
            })
          : await tx.membership.create({
              data: { orgId: inv.orgId, userId: user.id, role: inv.role },
            });
        await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
        // Accepting proves the user controls the email address.
        if (!user.emailVerifiedAt) {
          await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
        }
        await tx.auditLog.create({
          data: {
            orgId: inv.orgId,
            actorUserId: user.id,
            ip,
            action: 'invitation.accepted',
            entityType: 'Membership',
            entityId: String(membership.id),
            before: existing ? { role: existing.role, status: existing.status } : undefined,
            after: { role: membership.role, status: membership.status },
          },
        });
      });
      return { orgSlug: inv.org.slug };
    },
  };
}

export type OrgService = ReturnType<typeof createOrgService>;
