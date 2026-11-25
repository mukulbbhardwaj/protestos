import { CreateOrgInput, InvitationPreview } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const TokenParams = z.object({ token: z.string().min(10).max(200) });

export const onboardingRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (
  app,
  { services },
) => {
  app.post(
    '/orgs',
    {
      preHandler: requireUser,
      schema: {
        body: CreateOrgInput,
        response: { 201: z.object({ id: z.number(), slug: z.string(), name: z.string() }) },
      },
    },
    async (request, reply) => {
      const org = await services.orgs.createOrg(request.user!, request.body, request.ip);
      return reply.code(201).send(org);
    },
  );

  // Public: the invite page shows who invited you before you log in or sign up.
  app.get(
    '/invitations/:token',
    { schema: { params: TokenParams, response: { 200: InvitationPreview } } },
    async (request) => services.orgs.previewInvitation(request.params.token),
  );

  app.post(
    '/invitations/:token/accept',
    {
      preHandler: requireUser,
      schema: { params: TokenParams, response: { 200: z.object({ orgSlug: z.string() }) } },
    },
    async (request) =>
      services.orgs.acceptInvitation(request.user!, request.params.token, request.ip),
  );
};
