import type { Prisma } from '@app/db';
import { renderContractPdf } from '@app/pdf';
import {
  CONTRACT_PLACEHOLDERS,
  DEFAULT_CONTRACT,
  DocumentDto,
  DocumentListQuery,
  DocumentTemplateDto,
  EnvelopeDto,
  paged,
  PreviewDocumentQuery,
  ReasonInput,
  renderContract,
  SaveDocumentTemplateInput,
  SendDocumentsInput,
  unknownContractPlaceholders,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../errors.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import {
  buildDocuments,
  contractTemplate,
  DOCUMENT_INCLUDE,
  envelopeDto,
  remindEnvelope,
  sendDocuments,
  toDocumentDto,
  uploadSigned,
  voidEnvelope,
  type DocRow,
  type DocumentDeps,
} from '../../services/documents.js';
import { actorOf, Ok, OrgIdParams, OrgParams } from './params.js';

const pdfReply = (
  reply: {
    type: (t: string) => { header: (k: string, v: string) => { send: (b: Buffer) => unknown } };
  },
  name: string,
  bytes: Uint8Array,
) =>
  reply
    .type('application/pdf')
    .header('content-disposition', `inline; filename="${name}.pdf"`)
    .send(Buffer.from(bytes));

export const documentRoutes: FastifyPluginAsyncZod<{ deps: DocumentDeps }> = async (
  app,
  { deps },
) => {
  // Signed copies uploaded by staff (paper signatures).
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 },
    (_r, body, done) => done(null, body),
  );

  app.get(
    '/documents',
    {
      schema: {
        params: OrgParams,
        querystring: DocumentListQuery,
        response: { 200: paged(DocumentDto) },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const where: Prisma.DocumentWhereInput = {
        ...(q.status === 'OPEN'
          ? { status: { in: ['SENT', 'VIEWED'] } }
          : q.status
            ? { status: q.status }
            : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
      };
      const [rows, total] = await Promise.all([
        db.document.findMany({
          where,
          include: DOCUMENT_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.document.count({ where }),
      ]);
      return {
        items: rows.map((d) => toDocumentDto(d as DocRow)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.get(
    '/documents/:id/pdf',
    {
      schema: {
        params: OrgIdParams,
        querystring: z.object({ signed: z.enum(['true', 'false']).optional() }),
      },
    },
    async (request, reply) => {
      const { db } = tenantOf(request);
      const d = await db.document.findUnique({ where: { id: request.params.id } });
      if (!d) throw notFound('That document was not found.');
      const signed = request.query.signed !== 'false' && d.signedKey;
      const bytes = await deps.storage.get(signed ? d.signedKey! : d.unsignedKey);
      return pdfReply(reply, `${d.title}${signed ? ' (signed)' : ''}`, bytes);
    },
  );

  app.post(
    '/documents/:id/signed',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, response: { 200: DocumentDto } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      const pdf = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      await uploadSigned(db, orgId, deps.storage, request.params.id, pdf, userId);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'document.signedOffline',
        entityType: 'Document',
        entityId: request.params.id,
      });
      const d = await db.document.findUniqueOrThrow({
        where: { id: request.params.id },
        include: DOCUMENT_INCLUDE,
      });
      return toDocumentDto(d as DocRow);
    },
  );

  app.get(
    '/contacts/:id/documents/preview',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, querystring: PreviewDocumentQuery },
    },
    async (request, reply) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const built = await buildDocuments(db, deps, request.params.id, {
        kinds: [q.kind],
        propertyIds: q.propertyIds,
        taxYear: q.taxYear,
        signerName: q.signerName,
        signerEmail: q.signerEmail,
      });
      return pdfReply(reply, built.documents[0]!.title, built.documents[0]!.pdf);
    },
  );

  app.post(
    '/contacts/:id/documents',
    {
      preValidation: requireRole('STAFF'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: OrgIdParams, body: SendDocumentsInput, response: { 201: EnvelopeDto } },
    },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const id = await sendDocuments(db, orgId, deps, request.params.id, request.body, userId);
      const e = await envelopeDto(db, id, deps.appUrl);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'document.sent',
        entityType: 'Contact',
        entityId: request.params.id,
        after: {
          envelopeId: id,
          documents: e.documents.map((d) => d.title),
          signer: e.signerEmail,
        },
      });
      return reply.code(201).send(e);
    },
  );

  app.get(
    '/envelopes/:id',
    { schema: { params: OrgIdParams, response: { 200: EnvelopeDto } } },
    async (request) => envelopeDto(tenantOf(request).db, request.params.id, deps.appUrl),
  );

  app.post(
    '/envelopes/:id/remind',
    {
      preValidation: requireRole('STAFF'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: OrgIdParams, response: { 200: Ok } },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      await remindEnvelope(db, orgId, deps, request.params.id, userId);
      return { ok: true as const };
    },
  );

  app.post(
    '/envelopes/:id/void',
    {
      preValidation: requireRole('STAFF'),
      schema: { params: OrgIdParams, body: ReasonInput, response: { 200: EnvelopeDto } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      await voidEnvelope(db, deps, request.params.id, request.body.reason);
      await recordAudit(db, orgId, actorOf(request), {
        action: 'document.voided',
        entityType: 'SignatureEnvelope',
        entityId: request.params.id,
        after: { reason: request.body.reason },
      });
      return envelopeDto(db, request.params.id, deps.appUrl);
    },
  );

  // The engagement agreement's wording (Settings → Documents).
  const templateDto = async (
    db: ReturnType<typeof tenantOf>['db'],
  ): Promise<DocumentTemplateDto> => {
    const t = await contractTemplate(db);
    return {
      name: t.name,
      body: t.body,
      version: t.version,
      isCustom: t.version > 0,
      placeholders: Object.keys(CONTRACT_PLACEHOLDERS),
      updatedAt: t.updatedAt?.toISOString() ?? null,
    };
  };
  const checkBody = (body: string) => {
    const unknown = unknownContractPlaceholders(body);
    if (unknown.length)
      throw badRequest(`The agreement can't use ${unknown.map((u) => `{{${u}}}`).join(', ')}.`);
  };

  app.get(
    '/document-template',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, response: { 200: DocumentTemplateDto } },
    },
    async (request) => templateDto(tenantOf(request).db),
  );

  app.put(
    '/document-template',
    {
      preValidation: requireRole('ADMIN'),
      schema: {
        params: OrgParams,
        body: SaveDocumentTemplateInput,
        response: { 200: DocumentTemplateDto },
      },
    },
    async (request) => {
      const { db, orgId, userId } = tenantOf(request);
      checkBody(request.body.body);
      const before = await contractTemplate(db);
      await db.documentTemplate.upsert({
        where: { orgId_kind: { orgId, kind: 'ENGAGEMENT_CONTRACT' } },
        create: {
          orgId,
          kind: 'ENGAGEMENT_CONTRACT',
          name: DEFAULT_CONTRACT.name,
          body: request.body.body,
          version: 1,
          updatedById: userId,
        },
        update: { body: request.body.body, version: { increment: 1 }, updatedById: userId },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'documentTemplate.updated',
        entityType: 'DocumentTemplate',
        entityId: 'ENGAGEMENT_CONTRACT',
        before: { version: before.version, body: before.body },
        after: { body: request.body.body },
      });
      return templateDto(db);
    },
  );

  app.post(
    '/document-template/reset',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, response: { 200: DocumentTemplateDto } },
    },
    async (request) => {
      const { db, orgId } = tenantOf(request);
      const { count } = await db.documentTemplate.deleteMany({
        where: { kind: 'ENGAGEMENT_CONTRACT' },
      });
      if (count) {
        await recordAudit(db, orgId, actorOf(request), {
          action: 'documentTemplate.reset',
          entityType: 'DocumentTemplate',
          entityId: 'ENGAGEMENT_CONTRACT',
        });
      }
      return templateDto(db);
    },
  );

  // Unsaved wording with sample values, as the PDF clients will see.
  app.post(
    '/document-template/preview',
    {
      preValidation: requireRole('ADMIN'),
      schema: { params: OrgParams, body: SaveDocumentTemplateInput },
    },
    async (request, reply) => {
      const { db } = tenantOf(request);
      checkBody(request.body.body);
      const org = await db.org.findFirstOrThrow();
      const bytes = await renderContractPdf({
        org: {
          name: org.name,
          addressLines: org.addressLines,
          phone: org.phone,
          website: org.website,
          primaryColor: org.primaryColor,
          paymentInstructions: null,
        },
        title: DEFAULT_CONTRACT.name,
        blocks: renderContract(request.body.body, CONTRACT_PLACEHOLDERS),
        properties: [
          { county: 'Harris', accountNumber: '0660640130020', address: '1700 St Charles St' },
          { county: 'Harris', accountNumber: '1041940000005', address: '3235 Trail Lake Dr' },
        ],
        signer: { name: 'Jane Smith', email: 'jane@example.com' },
      });
      return pdfReply(reply, 'Agreement preview', bytes);
    },
  );
};
