import type { PrismaClient } from './generated/prisma/client.js';

/**
 * Models with an `orgId` column. `forOrg` injects the org into every query on them.
 * test/tenant-tables.test.ts fails if a table with `orgId` is missing from this list.
 */
export const TENANT_MODELS = [
  'Membership',
  'Invitation',
  'OrgSetting',
  'AuditLog',
  'Contact',
  'Property',
  'TaxYearRecord',
  'ProtestStageEvent',
  'ImportJob',
  'ImportRow',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'PaymentAllocation',
  'EmailTemplate',
  'EmailDelivery',
  'DocumentTemplate',
  'SignatureEnvelope',
  'Document',
  'DocumentProperty',
] as const;

/** Readable through `forOrg` (User filtered by RLS; the rest is shared reference data) but never writable. */
const READ_ONLY_MODELS = new Set(['User', 'County', 'CadParcel', 'CadTaxUnit', 'CadLoad']);

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const tenantModels = new Set<string>(TENANT_MODELS);

export class TenantScopeError extends Error {}

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function withOrg(data: unknown, orgId: number): Record<string, unknown> {
  // Drop any caller-supplied org relation or id: the scope decides the org.
  const { org: _org, orgId: _orgId, ...rest } = (data ?? {}) as Record<string, unknown>;
  return { ...rest, orgId };
}

function withoutOrg(data: unknown): Record<string, unknown> {
  const { org: _org, orgId: _orgId, ...rest } = (data ?? {}) as Record<string, unknown>;
  return rest;
}

/** Rewrites query args so they can only touch rows of `orgId`. Exported for tests. */
export function scopeArgs(model: string, operation: string, args: Args, orgId: number): Args {
  if (model === 'Org') {
    if (READ_OPS.has(operation)) return { ...args, where: { ...args.where, id: orgId } };
    if (operation === 'update' || operation === 'updateMany') {
      return { ...args, where: { ...args.where, id: orgId }, data: withoutOrg(args.data) };
    }
    throw new TenantScopeError(`Org.${operation} is not allowed in an org scope`);
  }

  if (READ_ONLY_MODELS.has(model)) {
    if (READ_OPS.has(operation)) return args;
    throw new TenantScopeError(`${model}.${operation} is not allowed in an org scope`);
  }

  if (!tenantModels.has(model)) {
    throw new TenantScopeError(`${model} is not a tenant model`);
  }

  switch (operation) {
    case 'create':
      return { ...args, data: withOrg(args.data, orgId) };
    case 'createMany':
    case 'createManyAndReturn': {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      return { ...args, data: rows.map((row) => withOrg(row, orgId)) };
    }
    case 'upsert':
      return {
        ...args,
        where: { ...args.where, orgId },
        create: withOrg(args.create, orgId),
        update: withoutOrg(args.update),
      };
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      return { ...args, where: { ...args.where, orgId }, data: withoutOrg(args.data) };
    default:
      // reads, delete, deleteMany
      return { ...args, where: { ...args.where, orgId } };
  }
}

function assertOrgId(orgId: number): void {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) {
    throw new TenantScopeError(`Invalid orgId: ${String(orgId)}`);
  }
}

/**
 * The only way app code reads or writes tenant data.
 *
 * Each query runs in its own transaction as the `app_tenant` role with
 * `app.current_org_id` set, so Postgres RLS filters rows even if the injected
 * `where` were somehow bypassed.
 */
export function forOrg(prisma: PrismaClient, orgId: number) {
  assertOrgId(orgId);
  return prisma.$extends({
    name: 'forOrg',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeArgs(model, operation, args as Args, orgId);
          const [, , result] = await prisma.$transaction([
            prisma.$executeRawUnsafe('SET LOCAL ROLE app_tenant'),
            prisma.$executeRaw`SELECT set_config('app.current_org_id', ${String(orgId)}, true)`,
            query(scoped as typeof args),
          ]);
          return result;
        },
      },
    },
  });
}

export type OrgDb = ReturnType<typeof forOrg>;
