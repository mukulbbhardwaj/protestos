import { roleAtLeast, type OrgRole } from '@app/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden, notFound, unauthorized } from '../errors.js';
import type { Services } from '../services/index.js';
import type { TenantContext } from './context.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves `request.tenant` for every route in this (encapsulated) scope, which is
 * mounted at /orgs/:orgSlug. Membership is checked on every request (BUILD_PLAN 6.1).
 */
export function registerTenantContext(app: FastifyInstance, services: Services) {
  app.addHook('onRequest', async (request) => {
    if (!request.user) throw unauthorized();
    const { orgSlug } = request.params as { orgSlug?: string };
    if (!orgSlug) throw notFound();
    const membership = await services.orgs.resolveMembership(request.user.id, orgSlug);
    // Same response for "no such org" and "not your org".
    if (!membership) throw notFound("We couldn't find that firm, or you're not a member of it.");
    if (membership.role === 'READ_ONLY' && !SAFE_METHODS.has(request.method)) {
      throw forbidden('Your account is view-only. Ask an owner or admin for edit access.');
    }
    request.tenant = {
      ...membership,
      userId: request.user.id,
      db: services.tenantDb(membership.orgId),
    };
  });
}

/** preValidation hook factory (runs before body validation): 403 unless the caller's org role is at least `minimum`. */
export function requireRole(minimum: OrgRole) {
  return async (request: FastifyRequest) => {
    if (!request.tenant || !roleAtLeast(request.tenant.role, minimum)) throw forbidden();
  };
}

/** The tenant context, for handlers inside the tenant scope. */
export function tenantOf(request: FastifyRequest): TenantContext {
  if (!request.tenant) throw new Error('tenantOf() used outside the /orgs/:orgSlug scope');
  return request.tenant;
}
