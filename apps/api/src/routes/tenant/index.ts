import type { FastifyPluginAsync } from 'fastify';
import { registerTenantContext } from '../../plugins/tenant.js';
import type { Services } from '../../services/index.js';
import { auditLogRoutes } from './audit-log.js';
import { financeRoutes } from './finance.js';
import { invitationRoutes } from './invitations.js';
import { memberRoutes } from './members.js';
import { overviewRoutes } from './overview.js';
import { settingsRoutes } from './settings.js';

/** Mounted at /orgs/:orgSlug. Every route here gets an isolation test (test/isolation.test.ts). */
export const tenantRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  { services },
) => {
  registerTenantContext(app, services);
  await app.register(overviewRoutes);
  await app.register(settingsRoutes);
  await app.register(memberRoutes);
  await app.register(invitationRoutes, { services });
  await app.register(auditLogRoutes);
  await app.register(financeRoutes);
};
