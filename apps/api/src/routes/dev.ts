import type { DevFileMailProvider } from '@app/providers';
import type { FastifyPluginAsync } from 'fastify';

/** Development only: lists emails written by DevFileMailProvider. Never registered in production. */
export const devRoutes: FastifyPluginAsync<{ mailbox: DevFileMailProvider }> = async (
  app,
  { mailbox },
) => {
  app.get('/dev/mail', async () => ({ messages: await mailbox.list() }));
};
