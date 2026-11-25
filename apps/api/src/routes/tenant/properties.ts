import {
  BulkAssignInput,
  BulkResult,
  BulkRolloverInput,
  BulkStageInput,
  ChangeStageInput,
  CreatePropertyInput,
  CreateTaxYearInput,
  paged,
  PropertyDetail,
  PropertyListQuery,
  PropertySummary,
  TaxYearRecord,
  UpdatePropertyInput,
  UpdateTaxYearInput,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Prisma } from '@app/db';
import { badRequest, conflict, notFound } from '../../errors.js';
import type { TenantContext } from '../../plugins/context.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { diff, recordAudit } from '../../services/audit.js';
import {
  address,
  currentTaxYear,
  dec,
  iso,
  money,
  normalizeAccount,
  propertySummaryInclude,
  toDay,
  toPropertySummary,
  toStageEvent,
  toTaxYear,
} from './mappers.js';
import { actorOf, OrgIdParams, OrgParams } from './params.js';

type Db = TenantContext['db'];

async function firmYear(db: Db) {
  const org = await db.org.findFirstOrThrow({ select: { taxYearDefault: true } });
  return currentTaxYear(org);
}

/** A consultant must be an active member of this firm. */
async function assertConsultant(db: Db, userId: number | null | undefined) {
  if (userId == null) return;
  const member = await db.membership.findFirst({
    where: { userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!member) throw badRequest('That consultant is not an active member of your firm.');
}

function uniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

async function loadDetail(db: Db, id: number): Promise<PropertyDetail> {
  const p = await db.property.findUnique({
    where: { id },
    include: {
      county: true,
      contact: {
        select: {
          id: true,
          displayName: true,
          clientNumber: true,
          contingencyPct: true,
          flatFee: true,
          bppFee: true,
        },
      },
      consultant: { select: { id: true, name: true } },
      taxYears: {
        orderBy: { taxYear: 'desc' },
        include: {
          stageEvents: {
            orderBy: { at: 'desc' },
            include: {
              actor: { select: { name: true } },
              taxYearRecord: { select: { taxYear: true } },
            },
          },
        },
      },
    },
  });
  if (!p) throw notFound('That property was not found.');
  const org = await db.org.findFirstOrThrow({
    select: {
      taxYearDefault: true,
      savingsBasis: true,
      flatFeeCurrentYearOnly: true,
      defaultContingencyPct: true,
      defaultFlatFee: true,
      defaultBppFee: true,
    },
  });
  return {
    id: p.id,
    accountNumber: p.accountNumber,
    county: {
      id: p.county.id,
      name: p.county.name,
      cadName: p.county.cadName,
      cadWebsite: p.county.cadWebsite,
    },
    situsLine: p.situsLine,
    situsAddress: address(p.situsAddress),
    propertyType: p.propertyType,
    contact: {
      id: p.contact.id,
      displayName: p.contact.displayName,
      clientNumber: p.contact.clientNumber,
    },
    consultant: p.consultant,
    contingencyPct: dec(p.contingencyPct),
    flatFee: money(p.flatFee),
    bppFee: money(p.bppFee),
    notes: p.notes,
    archivedAt: iso(p.archivedAt),
    archivedWithContact: p.archivedWithContact,
    createdAt: p.createdAt.toISOString(),
    taxYears: p.taxYears.map(toTaxYear),
    stageEvents: p.taxYears
      .flatMap((t) => t.stageEvents)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 100)
      .map(toStageEvent),
    feeContext: {
      savingsBasis: org.savingsBasis,
      flatFeeCurrentYearOnly: org.flatFeeCurrentYearOnly,
      currentTaxYear: currentTaxYear(org),
      firm: {
        defaultContingencyPct: org.defaultContingencyPct.toString(),
        defaultFlatFee: org.defaultFlatFee.toFixed(2),
        defaultBppFee: org.defaultBppFee.toFixed(2),
      },
      client: {
        contingencyPct: dec(p.contact.contingencyPct),
        flatFee: money(p.contact.flatFee),
        bppFee: money(p.contact.bppFee),
      },
      property: {
        contingencyPct: dec(p.contingencyPct),
        flatFee: money(p.flatFee),
        bppFee: money(p.bppFee),
      },
    },
  };
}

function situs(a: { line1: string; city: string; zip: string } | null | undefined) {
  if (a === undefined) return undefined;
  if (a === null || (!a.line1 && !a.city)) return null;
  return [a.line1, a.city, a.zip ? `TX ${a.zip}` : 'TX'].filter(Boolean).join(', ');
}

export const propertyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/properties',
    {
      schema: {
        params: OrgParams,
        querystring: PropertyListQuery,
        response: { 200: paged(PropertySummary) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const year = q.taxYear ?? (await firmYear(db));
      const where = {
        ...(q.archived === 'active'
          ? { archivedAt: null }
          : q.archived === 'archived'
            ? { archivedAt: { not: null } }
            : {}),
        ...(q.countyId ? { countyId: q.countyId } : {}),
        ...(q.type ? { propertyType: q.type } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.consultantId === 'none'
          ? { consultantUserId: null }
          : q.consultantId
            ? { consultantUserId: q.consultantId }
            : {}),
        ...(q.stage ? { taxYears: { some: { taxYear: year, protestStage: q.stage } } } : {}),
        ...(q.q
          ? {
              OR: [
                {
                  accountNumber: { contains: normalizeAccount(q.q), mode: 'insensitive' as const },
                },
                { situsLine: { contains: q.q, mode: 'insensitive' as const } },
                { contact: { displayName: { contains: q.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };
      const orderBy =
        q.sort === 'account'
          ? [{ accountNumber: 'asc' as const }]
          : q.sort === 'county'
            ? [{ county: { name: 'asc' as const } }, { accountNumber: 'asc' as const }]
            : q.sort === 'newest'
              ? [{ createdAt: 'desc' as const }]
              : [{ contact: { displayName: 'asc' as const } }, { accountNumber: 'asc' as const }];
      const [items, total] = await Promise.all([
        db.property.findMany({
          where,
          orderBy,
          include: propertySummaryInclude(year),
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.property.count({ where }),
      ]);
      return { items: items.map(toPropertySummary), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.post(
    '/properties',
    { schema: { params: OrgParams, body: CreatePropertyInput, response: { 201: PropertyDetail } } },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const { taxYear, situsAddress, ...input } = request.body;
      // forOrg scoping makes another firm's contact invisible here, and the composite
      // foreign key would reject it anyway.
      const contact = await db.contact.findUnique({
        where: { id: input.contactId },
        select: { id: true },
      });
      if (!contact) throw notFound('That client was not found.');
      const county = await db.county.findUnique({
        where: { id: input.countyId },
        select: { id: true },
      });
      if (!county) throw badRequest('Choose a Texas county.');
      await assertConsultant(db, input.consultantUserId);
      let created;
      try {
        created = await db.property.create({
          data: {
            orgId,
            ...input,
            accountNumber: normalizeAccount(input.accountNumber),
            situsAddress: situsAddress ?? undefined,
            situsLine: situs(situsAddress) ?? null,
          },
        });
      } catch (e) {
        if (uniqueViolation(e))
          throw conflict('This account number is already in your firm for that county.');
        throw e;
      }
      if (taxYear) {
        const rec = await db.taxYearRecord.create({
          data: { orgId, propertyId: created.id, taxYear },
        });
        await db.protestStageEvent.create({
          data: {
            orgId,
            taxYearRecordId: rec.id,
            fromStage: null,
            toStage: 'NOT_STARTED',
            actorUserId: userId,
          },
        });
      }
      await recordAudit(db, orgId, actorOf(request), {
        action: 'property.created',
        entityType: 'Property',
        entityId: created.id,
        after: {
          accountNumber: created.accountNumber,
          countyId: created.countyId,
          contactId: created.contactId,
        },
      });
      return reply.code(201).send(await loadDetail(db, created.id));
    },
  );

  app.get(
    '/properties/:id',
    { schema: { params: OrgIdParams, response: { 200: PropertyDetail } } },
    async (request) => loadDetail(tenantOf(request).db, request.params.id),
  );

  app.patch(
    '/properties/:id',
    {
      schema: { params: OrgIdParams, body: UpdatePropertyInput, response: { 200: PropertyDetail } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await db.property.findUnique({ where: { id: request.params.id } });
      if (!before) throw notFound('That property was not found.');
      const { situsAddress, accountNumber, ...rest } = request.body;
      await assertConsultant(db, rest.consultantUserId);
      try {
        await db.property.update({
          where: { id: before.id },
          data: {
            ...rest,
            ...(accountNumber !== undefined
              ? { accountNumber: normalizeAccount(accountNumber) }
              : {}),
            ...(situsAddress !== undefined
              ? {
                  situsAddress: situsAddress ?? Prisma.DbNull,
                  situsLine: situs(situsAddress) ?? null,
                }
              : {}),
          },
        });
      } catch (e) {
        if (uniqueViolation(e))
          throw conflict('This account number is already in your firm for that county.');
        throw e;
      }
      const after = await db.property.findUniqueOrThrow({ where: { id: before.id } });
      const pick = (p: typeof before) => ({
        accountNumber: p.accountNumber,
        countyId: p.countyId,
        situsLine: p.situsLine,
        propertyType: p.propertyType,
        consultantUserId: p.consultantUserId,
        contingencyPct: dec(p.contingencyPct),
        flatFee: money(p.flatFee),
        bppFee: money(p.bppFee),
        notes: p.notes,
      });
      const changes = diff(pick(before), pick(after));
      if (Object.keys(changes.after).length > 0) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'property.updated',
          entityType: 'Property',
          entityId: before.id,
          ...changes,
        });
      }
      return loadDetail(db, before.id);
    },
  );

  for (const action of ['archive', 'restore'] as const) {
    app.post(
      `/properties/:id/${action}`,
      { schema: { params: OrgIdParams, response: { 200: PropertyDetail } } },
      async (request) => {
        const { db, orgId } = tenantOf(request);
        const p = await db.property.findUnique({ where: { id: request.params.id } });
        if (!p) throw notFound('That property was not found.');
        if ((action === 'archive') === Boolean(p.archivedAt)) {
          throw conflict(
            action === 'archive'
              ? 'This property is already archived.'
              : 'This property is not archived.',
          );
        }
        await db.property.update({
          where: { id: p.id },
          data: {
            archivedAt: action === 'archive' ? new Date() : null,
            archivedWithContact: false,
          },
        });
        await recordAudit(db, orgId, actorOf(request), {
          action: `property.${action === 'archive' ? 'archived' : 'restored'}`,
          entityType: 'Property',
          entityId: p.id,
        });
        return loadDetail(db, p.id);
      },
    );
  }

  app.post(
    '/properties/:id/tax-years',
    { schema: { params: OrgIdParams, body: CreateTaxYearInput, response: { 201: TaxYearRecord } } },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const p = await db.property.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!p) throw notFound('That property was not found.');
      let rec;
      try {
        rec = await db.taxYearRecord.create({
          data: { orgId, propertyId: p.id, taxYear: request.body.taxYear },
        });
      } catch (e) {
        if (uniqueViolation(e))
          throw conflict(`This property already has a ${request.body.taxYear} record.`);
        throw e;
      }
      await db.protestStageEvent.create({
        data: {
          orgId,
          taxYearRecordId: rec.id,
          fromStage: null,
          toStage: 'NOT_STARTED',
          actorUserId: userId,
        },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'taxYear.created',
        entityType: 'TaxYearRecord',
        entityId: rec.id,
        after: { propertyId: p.id, taxYear: rec.taxYear },
      });
      return reply.code(201).send(toTaxYear(rec));
    },
  );

  app.patch(
    '/tax-years/:id',
    { schema: { params: OrgIdParams, body: UpdateTaxYearInput, response: { 200: TaxYearRecord } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const before = await db.taxYearRecord.findUnique({ where: { id: request.params.id } });
      if (!before) throw notFound('That tax year was not found.');
      const { bppRenderedAt, noticeReceivedAt, protestFiledAt, resultAt, ...rest } = request.body;
      const updated = await db.taxYearRecord.update({
        where: { id: before.id },
        data: {
          ...rest,
          bppRenderedAt: toDay(bppRenderedAt),
          noticeReceivedAt: toDay(noticeReceivedAt),
          protestFiledAt: toDay(protestFiledAt),
          resultAt: toDay(resultAt),
        },
      });
      const changes = diff(toTaxYear(before), toTaxYear(updated));
      delete changes.before.updatedAt;
      delete changes.after.updatedAt;
      if (Object.keys(changes.after).length > 0) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'taxYear.updated',
          entityType: 'TaxYearRecord',
          entityId: before.id,
          ...changes,
        });
      }
      return toTaxYear(updated);
    },
  );

  app.post(
    '/tax-years/:id/stage',
    { schema: { params: OrgIdParams, body: ChangeStageInput, response: { 200: TaxYearRecord } } },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const rec = await db.taxYearRecord.findUnique({ where: { id: request.params.id } });
      if (!rec) throw notFound('That tax year was not found.');
      if (rec.protestStage === request.body.stage) return toTaxYear(rec);
      const updated = await db.taxYearRecord.update({
        where: { id: rec.id },
        data: { protestStage: request.body.stage },
      });
      await db.protestStageEvent.create({
        data: {
          orgId,
          taxYearRecordId: rec.id,
          fromStage: rec.protestStage,
          toStage: request.body.stage,
          note: request.body.note ?? null,
          actorUserId: userId,
        },
      });
      return toTaxYear(updated);
    },
  );

  // ---- Bulk actions (ids must belong to this firm; others are silently not found) -------

  const staff = requireRole('STAFF');

  app.post(
    '/properties/bulk/assign-consultant',
    {
      preValidation: staff,
      schema: { params: OrgParams, body: BulkAssignInput, response: { 200: BulkResult } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const { ids, consultantUserId } = request.body;
      await assertConsultant(db, consultantUserId);
      const res = await db.property.updateMany({
        where: { id: { in: ids } },
        data: { consultantUserId },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'property.bulkAssigned',
        entityType: 'Property',
        entityId: `${res.count} properties`,
        after: { consultantUserId, ids: ids.slice(0, 200) },
      });
      return { updated: res.count, skipped: ids.length - res.count };
    },
  );

  app.post(
    '/properties/bulk/stage',
    {
      preValidation: staff,
      schema: { params: OrgParams, body: BulkStageInput, response: { 200: BulkResult } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const { ids, taxYear, stage } = request.body;
      const records = await db.taxYearRecord.findMany({
        where: { propertyId: { in: ids }, taxYear, protestStage: { not: stage } },
        select: { id: true, protestStage: true },
      });
      if (records.length > 0) {
        await db.taxYearRecord.updateMany({
          where: { id: { in: records.map((r) => r.id) } },
          data: { protestStage: stage },
        });
        await db.protestStageEvent.createMany({
          data: records.map((r) => ({
            orgId,
            taxYearRecordId: r.id,
            fromStage: r.protestStage,
            toStage: stage,
            note: 'Bulk update',
            actorUserId: userId,
          })),
        });
      }
      return { updated: records.length, skipped: ids.length - records.length };
    },
  );

  app.post(
    '/properties/bulk/rollover',
    {
      preValidation: staff,
      schema: { params: OrgParams, body: BulkRolloverInput, response: { 200: BulkResult } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const { ids, taxYear } = request.body;
      const props = await db.property.findMany({
        where: { id: { in: ids }, archivedAt: null },
        select: { id: true },
      });
      const res = await db.taxYearRecord.createMany({
        data: props.map((p) => ({ orgId, propertyId: p.id, taxYear })),
        skipDuplicates: true,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'taxYear.rolledOver',
        entityType: 'TaxYearRecord',
        entityId: `${res.count} properties`,
        after: { taxYear },
      });
      return { updated: res.count, skipped: ids.length - res.count };
    },
  );
};
