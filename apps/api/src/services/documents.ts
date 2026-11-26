import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findWorkspaceRoot } from '@app/shared/node';
import type { OrgDb } from '@app/db';
import { fill50162, renderContractPdf, stampSignature } from '@app/pdf';
import type { SignatureProvider, StorageProvider } from '@app/providers';
import {
  CONTRACT_PLACEHOLDERS,
  DEFAULT_CONTRACT,
  DOCUMENT_TITLES,
  renderContract,
  type DocumentDto,
  type DocumentKind,
  type EnvelopeDto,
} from '@app/shared';
import { badRequest, conflict, notFound } from '../errors.js';
import { JOBS, type JobQueue } from '../jobs.js';
import { address } from '../routes/tenant/mappers.js';

// Documents and e-signature (BUILD_PLAN 8.8, M6). PDFs are rendered once, stored, and sent
// as one envelope per signer. Signing completes through completeEnvelope, whichever way it
// happens: the mock /sign page today, a provider webhook later, or an offline upload.

type Db = OrgDb;

export interface DocumentDeps {
  storage: StorageProvider;
  signature: SignatureProvider;
  jobs: JobQueue;
  appUrl: string;
  /** The official blank Form 50-162, or null when it hasn't been installed. */
  form50162: () => Promise<Uint8Array | null>;
}

/** The official Form 50-162 (FORM_50162_PATH, or packages/pdf/assets/tx-50-162.pdf). */
export async function loadForm50162(): Promise<Uint8Array | null> {
  const path =
    process.env.FORM_50162_PATH ??
    join(findWorkspaceRoot() ?? process.cwd(), 'packages/pdf/assets/tx-50-162.pdf');
  return readFile(path).catch(() => null);
}

export async function contractTemplate(
  db: Db,
): Promise<{ name: string; body: string; version: number; updatedAt: Date | null }> {
  const t = await db.documentTemplate.findFirst({ where: { kind: 'ENGAGEMENT_CONTRACT' } });
  return (
    t ?? { name: DEFAULT_CONTRACT.name, body: DEFAULT_CONTRACT.body, version: 0, updatedAt: null }
  );
}

const oneLine = (v: unknown) => {
  const a = address(v);
  return a
    ? [a.line1, a.line2, a.city, [a.state, a.zip].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : '';
};
const longDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
const pct = (v: { toString(): string } | null | undefined) =>
  v == null ? null : `${Number(v.toString())}%`;
const usd = (v: { toString(): string } | null | undefined) =>
  Number(v?.toString() ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface Input {
  kinds: DocumentKind[];
  propertyIds: number[];
  taxYear: number;
  signerName: string;
  signerEmail: string;
}

async function loadContext(db: Db, contactId: number, input: Input) {
  const org = await db.org.findFirstOrThrow();
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw notFound('That client was not found.');
  const properties = await db.property.findMany({
    where: { id: { in: input.propertyIds }, contactId, archivedAt: null },
    include: { county: { select: { name: true, cadName: true } } },
    orderBy: [{ county: { name: 'asc' } }, { accountNumber: 'asc' }],
  });
  if (properties.length !== new Set(input.propertyIds).size) {
    throw badRequest("Some of those properties aren't this client's (or are archived).");
  }
  return { org, contact, properties };
}
type Context = Awaited<ReturnType<typeof loadContext>>;

const pdfOrg = (o: Context['org']) => ({
  name: o.name,
  addressLines: o.addressLines,
  phone: o.phone,
  website: o.website,
  primaryColor: o.primaryColor,
  paymentInstructions: o.paymentInstructions,
});

/** The PDFs to send: one contract for all properties, one 50-162 per appraisal district. */
export interface BuiltDocuments {
  contact: { kind: string; status: string | null };
  allowResendSigned: boolean;
  documents: {
    kind: DocumentKind;
    title: string;
    pdf: Uint8Array;
    propertyIds: number[];
    templateVersion: number | null;
  }[];
}

export async function buildDocuments(
  db: Db,
  deps: DocumentDeps,
  contactId: number,
  input: Input,
): Promise<BuiltDocuments> {
  const ctx = await loadContext(db, contactId, input);
  const { org, contact, properties } = ctx;
  const out: {
    kind: DocumentKind;
    title: string;
    pdf: Uint8Array;
    propertyIds: number[];
    templateVersion: number | null;
  }[] = [];

  if (input.kinds.includes('ENGAGEMENT_CONTRACT')) {
    const t = await contractTemplate(db);
    const vars: Record<string, string> = {
      ...Object.fromEntries(Object.keys(CONTRACT_PLACEHOLDERS).map((k) => [k, ''])),
      'org.name': org.name,
      'org.address': org.addressLines.join(', '),
      'org.phone': org.phone ?? '',
      'agent.name': org.agentName ?? org.name,
      'agent.license': org.agentLicense ?? '',
      'client.displayName': contact.displayName,
      'client.address': oneLine(contact.mailingAddress),
      contingencyPct: pct(contact.contingencyPct) ?? pct(org.defaultContingencyPct)!,
      flatFee: usd(contact.flatFee ?? org.defaultFlatFee),
      taxYear: String(input.taxYear),
      date: longDate(new Date()),
    };
    out.push({
      kind: 'ENGAGEMENT_CONTRACT',
      title: DOCUMENT_TITLES.ENGAGEMENT_CONTRACT,
      pdf: await renderContractPdf({
        org: pdfOrg(org),
        title: DOCUMENT_TITLES.ENGAGEMENT_CONTRACT,
        blocks: renderContract(t.body, vars),
        properties: properties.map((p) => ({
          county: p.county.name,
          accountNumber: p.accountNumber,
          address: p.situsLine,
        })),
        signer: { name: input.signerName, email: input.signerEmail },
      }),
      propertyIds: properties.map((p) => p.id),
      templateVersion: t.version,
    });
  }

  if (input.kinds.includes('AOA_50_162')) {
    const blank = await deps.form50162();
    if (!blank) {
      throw badRequest(
        "Form 50-162 isn't installed yet. An admin needs to add the official PDF (see packages/pdf/assets/README.md).",
        'FORM_NOT_INSTALLED',
      );
    }
    const byCounty = new Map<string, Context['properties']>();
    for (const p of properties)
      byCounty.set(p.county.cadName, [...(byCounty.get(p.county.cadName) ?? []), p]);
    for (const [cad, list] of byCounty) {
      const { pdf } = await fill50162(blank, {
        owner: {
          name: contact.nameOnCad ?? contact.displayName,
          address: oneLine(contact.mailingAddress),
          phone: contact.phone,
          email: contact.email,
        },
        appraisalDistrict: cad,
        properties: list.map((p) => ({
          accountNumber: p.accountNumber,
          address: p.situsLine ?? '',
        })),
        agent: {
          name: org.agentName ?? org.name,
          title: org.agentTitle,
          address: org.addressLines.join(', '),
          phone: org.phone,
          license: org.agentLicense,
        },
        taxYear: input.taxYear,
      });
      out.push({
        kind: 'AOA_50_162',
        title:
          byCounty.size > 1 ? `${DOCUMENT_TITLES.AOA_50_162} - ${cad}` : DOCUMENT_TITLES.AOA_50_162,
        pdf,
        propertyIds: list.map((p) => p.id),
        templateVersion: null,
      });
    }
  }
  return {
    contact: { kind: contact.kind, status: contact.status },
    allowResendSigned: org.allowResendSigned,
    documents: out,
  };
}

/** Creates the documents, sends them as one envelope, and emails the signing link if needed. */
export async function sendDocuments(
  db: Db,
  orgId: number,
  deps: DocumentDeps,
  contactId: number,
  input: Input,
  actorUserId: number | null,
): Promise<number> {
  const built = await buildDocuments(db, deps, contactId, input);
  if (!built.allowResendSigned) {
    const already = await db.document.findMany({
      where: {
        status: 'SIGNED',
        taxYear: input.taxYear,
        kind: { in: input.kinds },
        properties: { some: { propertyId: { in: input.propertyIds } } },
      },
      select: { title: true },
    });
    if (already.length) {
      throw conflict(
        `Already signed for ${input.taxYear}: ${[...new Set(already.map((d) => d.title))].join(', ')}. Turn on "Allow sending signed documents again" in Settings to send anyway.`,
      );
    }
  }

  const reference = `ENV-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { providerRef } = await deps.signature.createEnvelope({
    reference,
    signer: { name: input.signerName, email: input.signerEmail },
    documents: built.documents.map((d) => ({ title: d.title, pdf: d.pdf })),
  });
  const envelope = await db.signatureEnvelope.create({
    data: {
      orgId,
      contactId,
      provider: deps.signature.name,
      providerRef,
      signToken: deps.signature.sendsOwnEmail ? null : randomBytes(24).toString('base64url'),
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      createdById: actorUserId,
      events: [{ type: 'sent', at: new Date().toISOString(), detail: reference }],
    },
  });
  for (const d of built.documents) {
    const key = `org/${orgId}/documents/${randomUUID()}.pdf`;
    await deps.storage.put(key, Buffer.from(d.pdf), 'application/pdf');
    const doc = await db.document.create({
      data: {
        orgId,
        contactId,
        envelopeId: envelope.id,
        kind: d.kind,
        status: 'SENT',
        title: d.title,
        taxYear: input.taxYear,
        templateVersion: d.templateVersion,
        unsignedKey: key,
        createdById: actorUserId,
      },
    });
    await db.documentProperty.createMany({
      data: d.propertyIds.map((propertyId) => ({ orgId, documentId: doc.id, propertyId })),
    });
  }
  if (!deps.signature.sendsOwnEmail)
    await queueSigningEmail(db, orgId, deps.jobs, envelope.id, 'DOC_REQUEST', actorUserId);
  if (
    built.contact.kind === 'PROSPECT' &&
    ['NEW', 'CONTACTED'].includes(built.contact.status ?? '')
  ) {
    await db.contact.update({ where: { id: contactId }, data: { status: 'DOCS_SENT' } });
  }
  return envelope.id;
}

async function queueSigningEmail(
  db: Db,
  orgId: number,
  jobs: JobQueue,
  envelopeId: number,
  templateKey: 'DOC_REQUEST' | 'DOC_REMINDER',
  actorUserId: number | null,
) {
  const e = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
  const d = await db.emailDelivery.create({
    data: {
      orgId,
      templateKey,
      contactId: e.contactId,
      envelopeId,
      toEmail: e.signerEmail,
      idempotencyKey: `${templateKey.toLowerCase()}:envelope:${envelopeId}:${Date.now()}`,
      createdById: actorUserId,
    },
  });
  await jobs.send(JOBS.mailDeliver, { orgId, deliveryId: d.id });
}

export async function remindEnvelope(
  db: Db,
  orgId: number,
  deps: DocumentDeps,
  id: number,
  actorUserId: number | null,
) {
  const e = await db.signatureEnvelope.findUnique({ where: { id } });
  if (!e) throw notFound('That signing request was not found.');
  if (e.status !== 'SENT' && e.status !== 'VIEWED')
    throw conflict('Only unsigned requests can be reminded.');
  if (deps.signature.sendsOwnEmail)
    throw badRequest('Your e-signature provider sends its own reminders.');
  await queueSigningEmail(db, orgId, deps.jobs, id, 'DOC_REMINDER', actorUserId);
  await addEvent(db, id, 'reminded');
}

export async function voidEnvelope(db: Db, deps: DocumentDeps, id: number, reason: string) {
  const e = await db.signatureEnvelope.findUnique({ where: { id } });
  if (!e) throw notFound('That signing request was not found.');
  if (e.status === 'SIGNED' || e.status === 'VOIDED')
    throw conflict(`It's already ${e.status.toLowerCase()}.`);
  await deps.signature.voidEnvelope(e.providerRef, reason);
  await db.signatureEnvelope.update({
    where: { id },
    data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
  });
  await db.document.updateMany({
    where: { envelopeId: id, status: { not: 'SIGNED' } },
    data: { status: 'VOIDED' },
  });
  await addEvent(db, id, 'voided', reason);
}

async function addEvent(db: Db, envelopeId: number, type: string, detail?: string) {
  const e = await db.signatureEnvelope.findUniqueOrThrow({
    where: { id: envelopeId },
    select: { events: true },
  });
  const events = Array.isArray(e.events) ? e.events : [];
  await db.signatureEnvelope.update({
    where: { id: envelopeId },
    data: {
      events: [...events, { type, at: new Date().toISOString(), ...(detail ? { detail } : {}) }],
    },
  });
}

/** After a document is signed: protest stage → AOA_SIGNED for its property-years, prospect → SIGNED. */
async function afterSigned(db: Db, orgId: number, documentId: number, actorUserId: number | null) {
  const doc = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { properties: true, contact: { select: { id: true, kind: true, status: true } } },
  });
  if (doc.kind === 'AOA_50_162' && doc.taxYear) {
    for (const { propertyId } of doc.properties) {
      const rec = await db.taxYearRecord.findFirst({ where: { propertyId, taxYear: doc.taxYear } });
      if (!rec) {
        const created = await db.taxYearRecord.create({
          data: { orgId, propertyId, taxYear: doc.taxYear, protestStage: 'AOA_SIGNED' },
        });
        await db.protestStageEvent.create({
          data: {
            orgId,
            taxYearRecordId: created.id,
            fromStage: null,
            toStage: 'AOA_SIGNED',
            note: 'Form 50-162 signed',
            actorUserId,
          },
        });
      } else if (rec.protestStage === 'NOT_STARTED') {
        await db.taxYearRecord.update({
          where: { id: rec.id },
          data: { protestStage: 'AOA_SIGNED' },
        });
        await db.protestStageEvent.create({
          data: {
            orgId,
            taxYearRecordId: rec.id,
            fromStage: 'NOT_STARTED',
            toStage: 'AOA_SIGNED',
            note: 'Form 50-162 signed',
            actorUserId,
          },
        });
      }
    }
  }
  if (doc.contact.kind === 'PROSPECT' && doc.contact.status !== 'SIGNED') {
    await db.contact.update({ where: { id: doc.contact.id }, data: { status: 'SIGNED' } });
  }
}

/**
 * Stores the signed copies and applies the side effects. `signed` is in document order (by id);
 * the mock signs on our page, a real provider's copies come from getSignedDocuments.
 */
export async function completeEnvelope(
  db: Db,
  orgId: number,
  storage: StorageProvider,
  envelopeId: number,
  signed: Uint8Array[],
) {
  const docs = await db.document.findMany({
    where: { envelopeId, status: { not: 'VOIDED' } },
    orderBy: { id: 'asc' },
  });
  const at = new Date();
  for (const [i, doc] of docs.entries()) {
    const key = `org/${orgId}/documents/${randomUUID()}-signed.pdf`;
    await storage.put(key, Buffer.from(signed[i]!), 'application/pdf');
    await db.document.update({
      where: { id: doc.id },
      data: { status: 'SIGNED', signedKey: key, signedAt: at },
    });
    await afterSigned(db, orgId, doc.id, null);
  }
  await db.signatureEnvelope.update({
    where: { id: envelopeId },
    data: { status: 'SIGNED', completedAt: at },
  });
  await addEvent(db, envelopeId, 'signed');
}

/** The mock provider's signing: stamp each document, then complete. */
export async function signWithMock(
  db: Db,
  orgId: number,
  storage: StorageProvider,
  envelopeId: number,
  signerName: string,
  ip: string | null,
) {
  const e = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
  const docs = await db.document.findMany({
    where: { envelopeId, status: { not: 'VOIDED' } },
    orderBy: { id: 'asc' },
  });
  const signedAt = new Date();
  const signed: Uint8Array[] = [];
  for (const d of docs) {
    signed.push(
      await stampSignature(await storage.get(d.unsignedKey), {
        signerName,
        signerEmail: e.signerEmail,
        signedAt,
        ip,
        reference: e.providerRef,
        documentTitle: d.title,
      }),
    );
  }
  await completeEnvelope(db, orgId, storage, envelopeId, signed);
}

/** "Mark as signed and upload PDF" for paper signatures (BUILD_PLAN 8.8 offline fallback). */
export async function uploadSigned(
  db: Db,
  orgId: number,
  storage: StorageProvider,
  documentId: number,
  pdf: Buffer,
  actorUserId: number | null,
) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound('That document was not found.');
  if (doc.status === 'SIGNED') throw conflict('This document is already signed.');
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw badRequest('That file isn’t a PDF.');
  const key = `org/${orgId}/documents/${randomUUID()}-signed.pdf`;
  await storage.put(key, pdf, 'application/pdf');
  await db.document.update({
    where: { id: documentId },
    data: { status: 'SIGNED', signedKey: key, signedAt: new Date(), signedOffline: true },
  });
  await afterSigned(db, orgId, documentId, actorUserId);
  if (doc.envelopeId) {
    const open = await db.document.count({
      where: { envelopeId: doc.envelopeId, status: { notIn: ['SIGNED', 'VOIDED'] } },
    });
    if (!open) {
      await db.signatureEnvelope.update({
        where: { id: doc.envelopeId },
        data: { status: 'SIGNED', completedAt: new Date() },
      });
      await addEvent(db, doc.envelopeId, 'signed', 'Uploaded signed on paper');
    }
  }
}

// ---------------------------------------------------------------------------
// DTOs

export const DOCUMENT_INCLUDE = {
  contact: { select: { id: true, displayName: true, kind: true } },
  properties: {
    include: {
      property: { select: { id: true, accountNumber: true, county: { select: { name: true } } } },
    },
  },
} as const;

type DocRow = Awaited<ReturnType<Db['document']['findFirstOrThrow']>> & {
  contact: { id: number; displayName: string; kind: string };
  properties: { property: { id: number; accountNumber: string; county: { name: string } } }[];
};

export function toDocumentDto(d: DocRow): DocumentDto {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
    taxYear: d.taxYear,
    contact: d.contact,
    properties: d.properties.map((p) => ({
      id: p.property.id,
      accountNumber: p.property.accountNumber,
      county: p.property.county.name,
    })),
    envelopeId: d.envelopeId,
    hasSigned: Boolean(d.signedKey),
    signedOffline: d.signedOffline,
    signedAt: d.signedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function envelopeDto(db: Db, id: number, appUrl: string): Promise<EnvelopeDto> {
  const e = await db.signatureEnvelope.findUnique({
    where: { id },
    include: { documents: { include: DOCUMENT_INCLUDE, orderBy: { id: 'asc' } } },
  });
  if (!e) throw notFound('That signing request was not found.');
  return {
    id: e.id,
    provider: e.provider,
    status: e.status,
    signerName: e.signerName,
    signerEmail: e.signerEmail,
    sentAt: e.sentAt.toISOString(),
    viewedAt: e.viewedAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
    events: (Array.isArray(e.events) ? e.events : []) as EnvelopeDto['events'],
    documents: e.documents.map((d) => toDocumentDto(d as DocRow)),
    signingUrl:
      e.signToken && ['SENT', 'VIEWED'].includes(e.status) ? `${appUrl}/sign/${e.signToken}` : null,
  };
}
export type { DocRow };
