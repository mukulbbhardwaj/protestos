import {
  ContactDetail,
  ContactListQuery,
  ContactSummary,
  CreateContactInput,
  paged,
  PROSPECT_STATUSES,
  UpdateContactInput,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, notFound } from '../../errors.js';
import { tenantOf } from '../../plugins/tenant.js';
import { diff, recordAudit } from '../../services/audit.js';
import { toContactDetail, toContactSummary } from './mappers.js';
import { actorOf, OrgIdParams, OrgParams } from './params.js';

const activeProperties = { _count: { select: { properties: { where: { archivedAt: null } } } } };

/** Reserves the next client number for the org (row-locked increment, so no duplicates). */
async function nextClientNumber(db: ReturnType<typeof tenantOf>['db'], orgId: number) {
  const org = await db.org.update({
    where: { id: orgId },
    data: { nextClientNumber: { increment: 1 } },
    select: { nextClientNumber: true },
  });
  return String(org.nextClientNumber - 1);
}

export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/contacts',
    {
      schema: {
        params: OrgParams,
        querystring: ContactListQuery,
        response: { 200: paged(ContactSummary) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const where = {
        kind: q.kind,
        ...(q.status ? { status: q.status } : {}),
        ...(q.archived === 'active'
          ? { archivedAt: null }
          : q.archived === 'archived'
            ? { archivedAt: { not: null } }
            : {}),
        ...(q.countyId || q.consultantId
          ? {
              properties: {
                some: {
                  ...(q.countyId ? { countyId: q.countyId } : {}),
                  ...(q.consultantId ? { consultantUserId: q.consultantId } : {}),
                },
              },
            }
          : {}),
        ...(q.q
          ? {
              OR: [
                { displayName: { contains: q.q, mode: 'insensitive' as const } },
                { email: { contains: q.q, mode: 'insensitive' as const } },
                { clientNumber: { contains: q.q, mode: 'insensitive' as const } },
                { phone: { contains: q.q } },
              ],
            }
          : {}),
      };
      const orderBy =
        q.sort === 'clientNumber'
          ? [{ clientNumber: 'asc' as const }]
          : q.sort === 'newest'
            ? [{ createdAt: 'desc' as const }]
            : q.sort === 'properties'
              ? [{ properties: { _count: 'desc' as const } }, { displayName: 'asc' as const }]
              : [{ displayName: 'asc' as const }];
      const [items, total] = await Promise.all([
        db.contact.findMany({
          where,
          orderBy,
          include: activeProperties,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.contact.count({ where }),
      ]);
      return { items: items.map(toContactSummary), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/contacts/prospect-counts',
    {
      schema: {
        params: OrgParams,
        response: {
          200: z.object({
            counts: z.record(z.enum(PROSPECT_STATUSES), z.number()),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const rows = await tenantOf(request).db.contact.groupBy({
        by: ['status'],
        where: { kind: 'PROSPECT', archivedAt: null },
        _count: { _all: true },
      });
      const counts = Object.fromEntries(PROSPECT_STATUSES.map((s) => [s, 0])) as Record<
        (typeof PROSPECT_STATUSES)[number],
        number
      >;
      for (const r of rows) if (r.status) counts[r.status] = r._count._all;
      return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
    },
  );

  app.post(
    '/contacts',
    { schema: { params: OrgParams, body: CreateContactInput, response: { 201: ContactDetail } } },
    async (request, reply) => {
      const { db, orgId } = tenantOf(request);
      const { kind, status, ...fields } = request.body;
      const isClient = kind === 'CLIENT';
      const contact = await db.contact.create({
        data: {
          orgId,
          kind,
          ...fields,
          status: isClient ? null : (status ?? 'NEW'),
          clientNumber: isClient ? await nextClientNumber(db, orgId) : null,
          convertedAt: isClient ? new Date() : null,
          mailingAddress: fields.mailingAddress ?? undefined,
          billingAddress: fields.billingAddress ?? undefined,
        },
        include: activeProperties,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'contact.created',
        entityType: 'Contact',
        entityId: contact.id,
        after: { kind, displayName: contact.displayName, clientNumber: contact.clientNumber },
      });
      return reply.code(201).send(toContactDetail(contact));
    },
  );

  app.get(
    '/contacts/:id',
    { schema: { params: OrgIdParams, response: { 200: ContactDetail } } },
    async (request) => {
      const contact = await tenantOf(request).db.contact.findUnique({
        where: { id: request.params.id },
        include: activeProperties,
      });
      if (!contact) throw notFound('That client or prospect was not found.');
      return toContactDetail(contact);
    },
  );

  app.patch(
    '/contacts/:id',
    { schema: { params: OrgIdParams, body: UpdateContactInput, response: { 200: ContactDetail } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await db.contact.findUnique({
        where: { id: request.params.id },
        include: activeProperties,
      });
      if (!before) throw notFound('That client or prospect was not found.');
      const { mailingAddress, billingAddress, ...rest } = request.body;
      const updated = await db.contact.update({
        where: { id: before.id },
        data: {
          ...rest,
          ...(mailingAddress !== undefined ? { mailingAddress: mailingAddress ?? undefined } : {}),
          ...(billingAddress !== undefined ? { billingAddress: billingAddress ?? undefined } : {}),
        },
        include: activeProperties,
      });
      const changes = diff(toContactDetail(before), toContactDetail(updated));
      delete changes.before.updatedAt;
      delete changes.after.updatedAt;
      if (Object.keys(changes.after).length > 0) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'contact.updated',
          entityType: 'Contact',
          entityId: before.id,
          ...changes,
        });
      }
      return toContactDetail(updated);
    },
  );

  app.post(
    '/contacts/:id/convert',
    { schema: { params: OrgIdParams, response: { 200: ContactDetail } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const contact = await db.contact.findUnique({ where: { id: request.params.id } });
      if (!contact) throw notFound('That prospect was not found.');
      if (contact.kind === 'CLIENT') throw conflict('This contact is already a client.');
      const updated = await db.contact.update({
        where: { id: contact.id },
        data: {
          kind: 'CLIENT',
          status: 'SIGNED',
          clientNumber: contact.clientNumber ?? (await nextClientNumber(db, orgId)),
          // BUILD_PLAN 5.2: the original sign-up date is never overwritten.
          convertedAt: contact.convertedAt ?? new Date(),
        },
        include: activeProperties,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'contact.converted',
        entityType: 'Contact',
        entityId: contact.id,
        before: { kind: 'PROSPECT', status: contact.status },
        after: { kind: 'CLIENT', clientNumber: updated.clientNumber },
      });
      return toContactDetail(updated);
    },
  );

  app.post(
    '/contacts/:id/archive',
    { schema: { params: OrgIdParams, response: { 200: ContactDetail } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const contact = await db.contact.findUnique({ where: { id: request.params.id } });
      if (!contact) throw notFound('That client or prospect was not found.');
      if (contact.archivedAt) throw conflict('This contact is already archived.');
      const now = new Date();
      // Cascade: archive active properties and remember which ones came along.
      const cascaded = await db.property.updateMany({
        where: { contactId: contact.id, archivedAt: null },
        data: { archivedAt: now, archivedWithContact: true },
      });
      const updated = await db.contact.update({
        where: { id: contact.id },
        data: { archivedAt: now },
        include: activeProperties,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'contact.archived',
        entityType: 'Contact',
        entityId: contact.id,
        after: { propertiesArchived: cascaded.count },
      });
      return toContactDetail(updated);
    },
  );

  app.post(
    '/contacts/:id/restore',
    { schema: { params: OrgIdParams, response: { 200: ContactDetail } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const contact = await db.contact.findUnique({ where: { id: request.params.id } });
      if (!contact) throw notFound('That client or prospect was not found.');
      if (!contact.archivedAt) throw conflict('This contact is not archived.');
      // Only properties archived along with the contact come back.
      const restored = await db.property.updateMany({
        where: { contactId: contact.id, archivedWithContact: true },
        data: { archivedAt: null, archivedWithContact: false },
      });
      const updated = await db.contact.update({
        where: { id: contact.id },
        data: { archivedAt: null },
        include: activeProperties,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'contact.restored',
        entityType: 'Contact',
        entityId: contact.id,
        after: { propertiesRestored: restored.count },
      });
      return toContactDetail(updated);
    },
  );
};
