import { MAIL_SIGNATURE_HEADER, parseMailEvents, verifyMailWebhook } from '@app/providers';
import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../services/index.js';

/**
 * Provider webhooks (BUILD_PLAN 6.7): verify the signature over the raw body, then map each
 * event to its org through the stored provider message id. No session; no org in the URL.
 */
export const webhookRoutes: FastifyPluginAsync<{
  services: Services;
  mailSecret: string;
}> = async (app, { services, mailSecret }) => {
  // Keep the raw body: the signature is over the exact bytes received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: JSON.parse(body as string) as unknown });
    } catch {
      done(null, { raw: body as string, json: null });
    }
  });

  app.post('/webhooks/mail', async (request, reply) => {
    const { raw, json } = (request.body ?? { raw: '', json: null }) as {
      raw: string;
      json: unknown;
    };
    const signature = request.headers[MAIL_SIGNATURE_HEADER];
    if (
      !verifyMailWebhook(mailSecret, raw, typeof signature === 'string' ? signature : undefined)
    ) {
      return reply
        .code(401)
        .send({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature.' } });
    }
    const applied = await services.mailEvents.apply(parseMailEvents(json));
    return { ok: true, applied };
  });
};
