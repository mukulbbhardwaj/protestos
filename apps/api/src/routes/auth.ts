import {
  ForgotPasswordInput,
  LoginInput,
  Me,
  ResetPasswordInput,
  SignUpInput,
  TokenInput,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requestMeta, requireUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

export interface AuthRouteOptions {
  services: Services;
  rateLimitMax: number;
}

const Ok = z.object({ ok: z.literal(true) });

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, opts) => {
  const { auth } = opts.services;
  const limited = { rateLimit: { max: opts.rateLimitMax, timeWindow: '1 minute' } };

  app.post(
    '/auth/signup',
    { config: limited, schema: { body: SignUpInput, response: { 201: Me } } },
    async (request, reply) => {
      const session = await auth.signUp(request.body, requestMeta(request));
      const user = await auth.resolveSession(session.token);
      reply.setSession(session);
      return reply.code(201).send(await auth.me(user!));
    },
  );

  app.post(
    '/auth/login',
    { config: limited, schema: { body: LoginInput, response: { 200: Me } } },
    async (request, reply) => {
      const session = await auth.login(request.body, requestMeta(request));
      const user = await auth.resolveSession(session.token);
      reply.setSession(session);
      return auth.me(user!);
    },
  );

  app.post('/auth/logout', { schema: { response: { 200: Ok } } }, async (request, reply) => {
    if (request.sessionToken) await auth.logout(request.sessionToken);
    reply.clearSession();
    return { ok: true as const };
  });

  app.get(
    '/auth/me',
    { preHandler: requireUser, schema: { response: { 200: Me } } },
    async (request) => auth.me(request.user!),
  );

  app.post(
    '/auth/verify-email',
    { config: limited, schema: { body: TokenInput, response: { 200: Ok } } },
    async (request) => {
      await auth.verifyEmail(request.body.token);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/resend-verification',
    { config: limited, preHandler: requireUser, schema: { response: { 200: Ok } } },
    async (request) => {
      await auth.resendVerification(request.user!);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/forgot-password',
    { config: limited, schema: { body: ForgotPasswordInput, response: { 200: Ok } } },
    async (request) => {
      await auth.requestPasswordReset(request.body.email);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/reset-password',
    { config: limited, schema: { body: ResetPasswordInput, response: { 200: Ok } } },
    async (request, reply) => {
      await auth.resetPassword(request.body.token, request.body.password);
      reply.clearSession();
      return { ok: true as const };
    },
  );
};
