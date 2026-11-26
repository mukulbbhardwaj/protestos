import type { DevFileMailProvider } from '@app/providers';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services/index.js';

/** Development only: the dev mailbox. Never registered in production. */
export const devRoutes: FastifyPluginAsync<{
  mailbox: DevFileMailProvider;
  services: Services;
}> = async (app, { mailbox, services }) => {
  app.get('/dev/mail', async () => ({ messages: await mailbox.list() }));

  // Stands in for the provider's webhook, so delivered/opened/bounced can be tried locally.
  const Event = z.object({
    providerMessageId: z.string().min(1),
    type: z.enum(['delivered', 'opened', 'bounced', 'complained']),
    detail: z.string().max(200).optional(),
  });
  app.post('/dev/mail/events', async (request) => {
    const e = Event.parse(request.body);
    const applied = await services.mailEvents.apply([
      {
        ...e,
        id: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        at: new Date().toISOString(),
      },
    ]);
    return { ok: true, applied };
  });
};
