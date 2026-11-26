import { SignInput, SigningSession } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, notFound } from '../errors.js';
import { signWithMock, type DocumentDeps } from '../services/documents.js';
import type { Services } from '../services/index.js';

/**
 * The public signing page for the mock e-signature provider (M6). The long random token in the
 * link is the only credential; it finds the envelope, and with it the org. No session needed.
 */
export const signingRoutes: FastifyPluginAsyncZod<{
  services: Services;
  deps: DocumentDeps;
}> = async (app, { services, deps }) => {
  const limited = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  const Params = z.object({ token: z.string().min(20).max(100) });

  async function open(token: string) {
    const found = await services.signing.findByToken(token);
    if (!found) throw notFound('This signing link is not valid. Ask the firm for a new one.');
    const db = services.tenantDb(found.orgId);
    const envelope = await db.signatureEnvelope.findUniqueOrThrow({
      where: { id: found.id },
      include: { documents: { where: { status: { not: 'VOIDED' } }, orderBy: { id: 'asc' } } },
    });
    const org = await db.org.findFirstOrThrow({ select: { name: true } });
    return { db, orgId: found.orgId, envelope, org };
  }

  app.get(
    '/sign/:token',
    { config: limited, schema: { params: Params, response: { 200: SigningSession } } },
    async (request) => {
      const { db, envelope, org } = await open(request.params.token);
      if (envelope.status === 'SENT') {
        await db.signatureEnvelope.update({
          where: { id: envelope.id },
          data: { status: 'VIEWED', viewedAt: new Date() },
        });
        await db.document.updateMany({
          where: { envelopeId: envelope.id, status: 'SENT' },
          data: { status: 'VIEWED' },
        });
      }
      return {
        firm: org.name,
        signerName: envelope.signerName,
        status: envelope.status === 'SENT' ? 'VIEWED' : envelope.status,
        documents: envelope.documents.map((d, index) => ({ index, title: d.title })),
      };
    },
  );

  app.get(
    '/sign/:token/documents/:index',
    {
      config: limited,
      schema: { params: Params.extend({ index: z.coerce.number().int().min(0) }) },
    },
    async (request, reply) => {
      const { envelope } = await open(request.params.token);
      const d = envelope.documents[request.params.index];
      if (!d) throw notFound('That document was not found.');
      const bytes = await deps.storage.get(d.signedKey ?? d.unsignedKey);
      return reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="${d.title}.pdf"`)
        .send(Buffer.from(bytes));
    },
  );

  app.post(
    '/sign/:token',
    { config: limited, schema: { params: Params, body: SignInput } },
    async (request) => {
      const { db, orgId, envelope } = await open(request.params.token);
      if (envelope.status !== 'SENT' && envelope.status !== 'VIEWED') {
        throw conflict(`These documents are already ${envelope.status.toLowerCase()}.`);
      }
      await signWithMock(
        db,
        orgId,
        deps.storage,
        envelope.id,
        request.body.signerName,
        request.ip ?? null,
      );
      return { ok: true };
    },
  );

  app.post(
    '/sign/:token/decline',
    {
      config: limited,
      schema: { params: Params, body: z.object({ reason: z.string().trim().max(500).optional() }) },
    },
    async (request) => {
      const { db, envelope } = await open(request.params.token);
      if (envelope.status !== 'SENT' && envelope.status !== 'VIEWED') {
        throw conflict(`These documents are already ${envelope.status.toLowerCase()}.`);
      }
      const events = Array.isArray(envelope.events) ? envelope.events : [];
      await db.signatureEnvelope.update({
        where: { id: envelope.id },
        data: {
          status: 'DECLINED',
          events: [
            ...events,
            {
              type: 'declined',
              at: new Date().toISOString(),
              ...(request.body.reason ? { detail: request.body.reason } : {}),
            },
          ],
        },
      });
      await db.document.updateMany({
        where: { envelopeId: envelope.id },
        data: { status: 'DECLINED' },
      });
      return { ok: true };
    },
  );
};
