import { Prisma } from '@app/db';
import { ImportFileError, previewImport, readCsv } from '@app/imports';
import type { StorageProvider } from '@app/providers';
import {
  AVAILABLE_IMPORT_KINDS,
  autoMapColumns,
  IMPORT_KINDS,
  ImportJobDto,
  ImportListItem,
  ImportRowDto,
  ImportRowsQuery,
  importFields,
  ImportUploadQuery,
  paged,
  SAMPLE_CSVS,
  toCsvLine,
  UpdateMappingInput,
  type ImportKind,
} from '@app/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../errors.js';
import { JOBS, type JobQueue } from '../../jobs.js';
import type { TenantContext } from '../../plugins/context.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import { iso } from './mappers.js';
import { actorOf, OrgIdParams, OrgParams } from './params.js';

// CSV imports (BUILD_PLAN 8.9): upload → mapping → dry run → confirm → background job.

type Db = TenantContext['db'];

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const mappingKey = (kind: ImportKind) => `import.mapping.${kind}`;

const jobInclude = { createdBy: { select: { name: true } } } as const;
type JobRow = NonNullable<Awaited<ReturnType<Db['importJob']['findUnique']>>> & {
  createdBy: { name: string } | null;
};

function toListItem(j: JobRow): ImportListItem {
  const finished = j.status === 'DONE' || (j.status === 'FAILED' && j.startedAt !== null);
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    fileName: j.fileName,
    rowCount: j.rowCount,
    summary: (j.summary as ImportListItem['summary']) ?? null,
    phase: j.summary ? (finished || j.status === 'RUNNING' ? 'APPLY' : 'PREVIEW') : null,
    error: j.error,
    createdBy: j.createdBy?.name ?? null,
    createdAt: j.createdAt.toISOString(),
    previewedAt: iso(j.previewedAt),
    startedAt: iso(j.startedAt),
    finishedAt: iso(j.finishedAt),
  };
}

async function loadJob(db: Db, id: number) {
  const job = await db.importJob.findUnique({ where: { id }, include: jobInclude });
  if (!job) throw notFound('That import was not found.');
  return job as JobRow;
}

export const importRoutes: FastifyPluginAsyncZod<{
  storage: StorageProvider;
  jobs: JobQueue;
}> = async (app, { storage, jobs }) => {
  // Uploads arrive as the raw CSV text (no multipart): Content-Type text/csv.
  app.addContentTypeParser(
    ['text/csv', 'application/csv', 'text/plain'],
    { parseAs: 'string', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );
  // Imports change many records at once: staff and up only, reads included.
  app.addHook('preValidation', requireRole('STAFF'));

  async function toDto(job: JobRow): Promise<ImportJobDto> {
    let sample: string[][];
    try {
      sample = readCsv((await storage.get(job.fileKey)).toString('utf8')).rows.slice(0, 5);
    } catch {
      // The stored file went missing: the job is still shown, without sample values.
      sample = [];
    }
    return {
      ...toListItem(job),
      headers: job.headers,
      columnMapping: job.columnMapping as Record<string, string | null>,
      sample,
    };
  }

  app.get(
    '/imports',
    { schema: { params: OrgParams, response: { 200: z.array(ImportListItem) } } },
    async (request) => {
      const jobs = await tenantOf(request).db.importJob.findMany({
        include: jobInclude,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return jobs.map((j) => toListItem(j as JobRow));
    },
  );

  app.get(
    '/imports/template',
    { schema: { params: OrgParams, querystring: z.object({ kind: z.enum(IMPORT_KINDS) }) } },
    async (request, reply) => {
      const kind = request.query.kind;
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="sample-${kind.toLowerCase().replace(/_/g, '-')}.csv"`,
        )
        .send(`${SAMPLE_CSVS[kind]}\n`);
    },
  );

  app.post(
    '/imports',
    {
      schema: {
        params: OrgParams,
        querystring: ImportUploadQuery,
        body: z.string(),
        response: { 201: ImportJobDto },
      },
    },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const { kind, fileName } = request.query;
      if (!AVAILABLE_IMPORT_KINDS.includes(kind)) {
        throw badRequest('Historical invoices can be imported once invoicing is available.');
      }
      let parsed: { headers: string[]; rows: string[][] };
      try {
        parsed = readCsv(request.body);
      } catch (e) {
        if (e instanceof ImportFileError) throw badRequest(e.message);
        throw e;
      }
      const saved = await db.orgSetting.findFirst({ where: { key: mappingKey(kind) } });
      const fileKey = `org/${orgId}/imports/${randomUUID()}.csv`;
      await storage.put(fileKey, request.body, 'text/csv');
      const job = await db.importJob.create({
        data: {
          orgId,
          kind,
          fileKey,
          fileName,
          rowCount: parsed.rows.length,
          headers: parsed.headers,
          columnMapping: autoMapColumns(
            kind,
            parsed.headers,
            (saved?.value ?? {}) as Record<string, string>,
          ),
          createdById: userId,
        },
        include: jobInclude,
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'import.uploaded',
        entityType: 'ImportJob',
        entityId: job.id,
        after: { kind, fileName, rows: parsed.rows.length },
      });
      return reply.code(201).send(await toDto(job as JobRow));
    },
  );

  app.get(
    '/imports/:id',
    { schema: { params: OrgIdParams, response: { 200: ImportJobDto } } },
    async (request) => {
      const { db } = tenantOf(request);
      return toDto(await loadJob(db, request.params.id));
    },
  );

  app.patch(
    '/imports/:id/mapping',
    { schema: { params: OrgIdParams, body: UpdateMappingInput, response: { 200: ImportJobDto } } },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const job = await loadJob(db, request.params.id);
      if (job.status === 'RUNNING')
        throw conflict('This import is running; wait for it to finish.');
      const keys = new Set(importFields(job.kind).map((f) => f.key));
      const mapping: Record<string, string | null> = {};
      const used = new Set<string>();
      for (const header of job.headers) {
        const key = request.body.columnMapping[header] ?? null;
        if (key !== null && !keys.has(key))
          throw badRequest(`"${key}" isn't a field for this import.`);
        if (key !== null && used.has(key)) {
          throw badRequest('Two columns are mapped to the same field. Map each field once.');
        }
        if (key) used.add(key);
        mapping[header] = key;
      }
      const updated = await db.importJob.update({
        where: { id: job.id },
        // A new mapping invalidates the last dry run.
        data: {
          columnMapping: mapping,
          status: 'UPLOADED',
          summary: Prisma.DbNull,
          previewedAt: null,
        },
        include: jobInclude,
      });
      await db.importRow.deleteMany({ where: { importJobId: job.id } });
      if (request.body.remember) {
        const value = Object.fromEntries(Object.entries(mapping).filter(([, k]) => k !== null));
        await db.orgSetting.upsert({
          where: { orgId_key: { orgId, key: mappingKey(job.kind) } },
          create: { orgId, key: mappingKey(job.kind), value },
          update: { value },
        });
      }
      return toDto(updated as JobRow);
    },
  );

  app.post(
    '/imports/:id/preview',
    { schema: { params: OrgIdParams, response: { 200: ImportJobDto } } },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const job = await loadJob(db, request.params.id);
      if (job.status === 'RUNNING')
        throw conflict('This import is running; wait for it to finish.');
      try {
        await previewImport({ db, orgId, actorUserId: userId }, storage, job.id);
      } catch (e) {
        if (e instanceof ImportFileError) throw badRequest(e.message);
        throw e;
      }
      return toDto(await loadJob(db, job.id));
    },
  );

  app.post(
    '/imports/:id/run',
    { schema: { params: OrgIdParams, response: { 202: ImportJobDto } } },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const job = await loadJob(db, request.params.id);
      if (job.status === 'UPLOADED')
        throw conflict('Run a dry run first, so you can check what will change.');
      if (job.status === 'RUNNING') throw conflict('This import is already running.');
      await db.importJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'import.started',
        entityType: 'ImportJob',
        entityId: job.id,
      });
      await jobs.send(JOBS.importRun, { orgId, jobId: job.id, actorUserId: userId });
      return reply.code(202).send(await toDto(await loadJob(db, job.id)));
    },
  );

  app.get(
    '/imports/:id/rows',
    {
      schema: {
        params: OrgIdParams,
        querystring: ImportRowsQuery,
        response: { 200: paged(ImportRowDto) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const job = await loadJob(db, request.params.id);
      const where = {
        importJobId: job.id,
        ...(request.query.action ? { action: request.query.action } : {}),
      };
      const { page, pageSize } = request.query;
      const [rows, total] = await Promise.all([
        db.importRow.findMany({
          where,
          orderBy: { rowNumber: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { rowNumber: true, action: true, label: true, changes: true, messages: true },
        }),
        db.importRow.count({ where }),
      ]);
      return { items: rows, total, page, pageSize };
    },
  );

  app.get(
    '/imports/:id/errors.csv',
    { schema: { params: OrgIdParams } },
    async (request, reply) => {
      const { db } = tenantOf(request);
      const job = await loadJob(db, request.params.id);
      const errors = await db.importRow.findMany({
        where: { importJobId: job.id, action: 'ERROR' },
        orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, messages: true },
      });
      const { headers, rows } = readCsv((await storage.get(job.fileKey)).toString('utf8'));
      // The original rows, with what went wrong added: fix them and upload this file again.
      const lines = [
        toCsvLine([...headers, 'Import error']),
        ...errors.map((e) => toCsvLine([...(rows[e.rowNumber - 1] ?? []), e.messages.join(' ')])),
      ];
      const base = job.fileName.replace(/\.csv$/i, '');
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${base.replace(/"/g, '')}-errors.csv"`,
        )
        .send(`${lines.join('\n')}\n`);
    },
  );
};
