import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors.js';
import type { AuthSession } from '../services/auth.js';
import type { Services } from '../services/index.js';
import './context.js';

export const SESSION_COOKIE = 'sid';

export interface AuthPluginOptions {
  cookieSecure: boolean;
}

/** Registers cookie parsing and resolves `request.user` from the session cookie. */
export async function registerAuth(
  app: FastifyInstance,
  services: Services,
  opts: AuthPluginOptions,
) {
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('tenant', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await services.auth.resolveSession(token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
  });

  app.decorateReply('setSession', function (this: FastifyReply, session: AuthSession) {
    return this.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      expires: session.expiresAt,
    });
  });

  app.decorateReply('clearSession', function (this: FastifyReply) {
    return this.clearCookie(SESSION_COOKIE, { path: '/' });
  });
}

/** preHandler: 401 unless logged in. */
export async function requireUser(request: FastifyRequest) {
  if (!request.user) throw unauthorized();
}

export function requestMeta(request: FastifyRequest) {
  return { ip: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null };
}

declare module 'fastify' {
  interface FastifyReply {
    setSession(session: AuthSession): FastifyReply;
    clearSession(): FastifyReply;
  }
}
