import { randomBytes } from 'node:crypto';
import type { Prisma } from '@app/db';
import { moveToHearingScheduled } from '@app/imports';
import {
  CalendarFeedDto,
  CreateHearingInput,
  HearingDto,
  HearingListQuery,
  paged,
  UpdateHearingInput,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { diff, recordAudit } from '../../services/audit.js';
import { actorOf, Ok, OrgIdParams, OrgParams } from './params.js';

type Db = ReturnType<typeof tenantOf>['db'];

export const HEARING_INCLUDE = {
  property: {
    select: {
      id: true,
      accountNumber: true,
      situsLine: true,
      county: { select: { name: true } },
      contact: { select: { id: true, displayName: true } },
    },
  },
  assigned: { select: { id: true, name: true } },
} as const;

export function toHearingDto(
  h: Prisma.HearingGetPayload<{ include: typeof HEARING_INCLUDE }>,
): HearingDto {
  return {
    id: h.id,
    taxYear: h.taxYear,
    scheduledAt: h.scheduledAt.toISOString(),
    type: h.type,
    status: h.status,
    location: h.location,
    panel: h.panel,
    notes: h.notes,
    property: {
      id: h.property.id,
      accountNumber: h.property.accountNumber,
      county: h.property.county.name,
      situsLine: h.property.situsLine,
    },
    contact: h.property.contact,
    assignedTo: h.assigned,
  };
}

async function oneHearing(db: Db, id: number) {
  const h = await db.hearing.findFirst({
    where: { id, deletedAt: null },
    include: HEARING_INCLUDE,
  });
  if (!h) throw notFound('That hearing was not found.');
  return h;
}

async function assertConsultant(db: Db, userId: number | null | undefined) {
  if (!userId) return;
  const m = await db.membership.findFirst({
    where: { userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!m) throw badRequest('Choose a consultant from your team.');
}

export const hearingRoutes: FastifyPluginAsyncZod<{ appUrl: string }> = async (app, { appUrl }) => {
  app.get(
    '/hearings',
    {
      schema: {
        params: OrgParams,
        querystring: HearingListQuery,
        response: { 200: paged(HearingDto) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const where: Prisma.HearingWhereInput = {
        deletedAt: null,
        ...(q.from || q.to
          ? {
              scheduledAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.consultantId ? { assignedUserId: q.consultantId } : {}),
        ...(q.propertyId ? { propertyId: q.propertyId } : {}),
        ...(q.countyId ? { property: { countyId: q.countyId } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.hearing.findMany({
          where,
          include: HEARING_INCLUDE,
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.hearing.count({ where }),
      ]);
      return { items: rows.map(toHearingDto), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.post(
    '/hearings',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgParams, body: CreateHearingInput, response: { 201: HearingDto } },
    },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const b = request.body;
      const property = await db.property.findUnique({
        where: { id: b.propertyId },
        select: { id: true },
      });
      if (!property) throw notFound('That property was not found.');
      await assertConsultant(db, b.assignedUserId);
      const h = await db.hearing.create({
        data: {
          orgId,
          propertyId: b.propertyId,
          taxYear: b.taxYear,
          scheduledAt: new Date(b.scheduledAt),
          type: b.type,
          location: b.location ?? null,
          panel: b.panel ?? null,
          notes: b.notes ?? null,
          assignedUserId: b.assignedUserId ?? null,
        },
      });
      await moveToHearingScheduled({ db, orgId, actorUserId: userId }, b.propertyId, b.taxYear);
      const dto = toHearingDto(await oneHearing(db, h.id));
      await recordAudit(db, orgId, actorOf(request), {
        action: 'hearing.created',
        entityType: 'Hearing',
        entityId: h.id,
        after: dto,
      });
      return reply.code(201).send(dto);
    },
  );

  app.get(
    '/hearings/:id',
    { schema: { params: OrgIdParams, response: { 200: HearingDto } } },
    async (request) => toHearingDto(await oneHearing(tenantOf(request).db, request.params.id)),
  );

  app.patch(
    '/hearings/:id',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: UpdateHearingInput, response: { 200: HearingDto } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await oneHearing(db, request.params.id);
      const { scheduledAt, ...rest } = request.body;
      await assertConsultant(db, rest.assignedUserId);
      await db.hearing.update({
        where: { id: before.id },
        data: { ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}) },
      });
      const after = toHearingDto(await oneHearing(db, before.id));
      await recordAudit(db, orgId, actorOf(request), {
        action: 'hearing.updated',
        entityType: 'Hearing',
        entityId: before.id,
        ...diff(toHearingDto(before), after),
      });
      return after;
    },
  );

  app.delete(
    '/hearings/:id',
    { preValidation: requireRole('STAFF'), schema: { params: OrgIdParams, response: { 200: Ok } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await oneHearing(db, request.params.id);
      await db.hearing.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'hearing.deleted',
        entityType: 'Hearing',
        entityId: before.id,
        before: toHearingDto(before),
      });
      return { ok: true as const };
    },
  );

  // Each member's own subscribe-able calendar of the hearings assigned to them.
  const feedUrl = (token: string) => `${appUrl.replace(/\/$/, '')}/api/calendar/${token}.ics`;

  app.get(
    '/calendar-feed',
    { schema: { params: OrgParams, response: { 200: CalendarFeedDto } } },
    async (request) => {
      const { db, userId } = tenantOf(request);
      const m = await db.membership.findFirstOrThrow({
        where: { userId },
        select: { id: true, calendarToken: true },
      });
      const token = m.calendarToken ?? randomBytes(24).toString('base64url');
      if (!m.calendarToken)
        await db.membership.update({ where: { id: m.id }, data: { calendarToken: token } });
      return { url: feedUrl(token) };
    },
  );

  app.post(
    '/calendar-feed/rotate',
    { schema: { params: OrgParams, response: { 200: CalendarFeedDto } } },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const token = randomBytes(24).toString('base64url');
      await db.membership.updateMany({ where: { userId }, data: { calendarToken: token } });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'calendarFeed.rotated',
        entityType: 'Membership',
        entityId: userId,
      });
      return { url: feedUrl(token) };
    },
  );
};
