import type { Me } from '@app/shared';
import { generateToken, hashPassword, hashToken, verifyPassword } from '@app/shared/node';
import * as emails from '../emails.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import type { ServiceContext } from './context.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = DAY_MS;
const RESET_TTL_MS = 60 * 60 * 1000;
const SESSION_REFRESH_MS = DAY_MS;

// Compared against when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = await hashPassword('timing-equalizer-not-a-real-password');

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  isSuperAdmin: boolean;
}

export interface AuthSession {
  token: string;
  expiresAt: Date;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function createAuthService(ctx: ServiceContext) {
  const { prisma, mail, config } = ctx;
  const ttlMs = config.sessionTtlDays * DAY_MS;

  async function createSession(userId: number, meta: RequestMeta): Promise<AuthSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    await prisma.session.create({
      data: {
        id: hashToken(token),
        userId,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { token, expiresAt };
  }

  async function issueToken(userId: number, kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const token = generateToken();
    // Only the newest link of each kind works.
    await prisma.authToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.authToken.create({
      data: {
        userId,
        kind,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + (kind === 'VERIFY_EMAIL' ? VERIFY_TTL_MS : RESET_TTL_MS)),
      },
    });
    return token;
  }

  async function consumeToken(token: string, kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) {
      throw badRequest(
        'This link has expired or was already used. Request a new one.',
        'INVALID_TOKEN',
      );
    }
    await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row.userId;
  }

  async function sendVerification(user: { id: number; email: string; name: string }) {
    const token = await issueToken(user.id, 'VERIFY_EMAIL');
    await mail.send(
      emails.verifyEmail(user.email, user.name, `${config.appUrl}/verify-email?token=${token}`),
    );
  }

  return {
    async signUp(
      input: { name: string; email: string; password: string },
      meta: RequestMeta,
    ): Promise<AuthSession> {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        throw conflict('An account with this email already exists. Log in instead.', 'EMAIL_TAKEN');
      }
      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
        },
      });
      await sendVerification(user);
      return createSession(user.id, meta);
    },

    async login(input: { email: string; password: string }, meta: RequestMeta) {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.passwordHash || !ok) {
        throw unauthorized('Email or password is incorrect.');
      }
      return createSession(user.id, meta);
    },

    async logout(token: string): Promise<void> {
      await prisma.session.deleteMany({ where: { id: hashToken(token) } });
    },

    /** Resolves a cookie token to its user, sliding the expiry forward once a day. */
    async resolveSession(token: string): Promise<SessionUser | null> {
      const id = hashToken(token);
      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              emailVerifiedAt: true,
              isSuperAdmin: true,
            },
          },
        },
      });
      if (!session) return null;
      const now = Date.now();
      if (session.expiresAt.getTime() <= now) {
        await prisma.session.deleteMany({ where: { id } });
        return null;
      }
      if (now - session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
        await prisma.session.update({
          where: { id },
          data: { lastSeenAt: new Date(now), expiresAt: new Date(now + ttlMs) },
        });
      }
      return session.user;
    },

    async me(user: SessionUser): Promise<Me> {
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        include: { org: { select: { id: true, slug: true, name: true } } },
        // Oldest first: the firm someone joined first is their default landing page.
        orderBy: { createdAt: 'asc' },
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerifiedAt !== null,
          isSuperAdmin: user.isSuperAdmin,
        },
        memberships: memberships.map((m) => ({
          orgId: m.org.id,
          orgSlug: m.org.slug,
          orgName: m.org.name,
          role: m.role,
        })),
      };
    },

    async verifyEmail(token: string): Promise<void> {
      const userId = await consumeToken(token, 'VERIFY_EMAIL');
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    },

    async resendVerification(user: SessionUser): Promise<void> {
      if (user.emailVerifiedAt) return;
      await sendVerification(user);
    },

    /** Always succeeds, so the response doesn't reveal whether an account exists. */
    async requestPasswordReset(email: string): Promise<void> {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return;
      const token = await issueToken(user.id, 'RESET_PASSWORD');
      await mail.send(
        emails.resetPassword(user.email, `${config.appUrl}/reset-password?token=${token}`),
      );
    },

    async resetPassword(token: string, password: string): Promise<void> {
      const userId = await consumeToken(token, 'RESET_PASSWORD');
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          // Receiving the reset email proves the address too.
          data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
        }),
        // Sign out everywhere: whoever knew the old password loses access.
        prisma.session.deleteMany({ where: { userId } }),
      ]);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
