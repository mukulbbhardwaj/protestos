import { z } from 'zod';
import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from '../documents/index.js';
import { Email, Id } from './common.js';

// Documents and e-signature API (M6).

export const DocumentDto = z.object({
  id: z.number(),
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  taxYear: z.number().nullable(),
  contact: z.object({ id: z.number(), displayName: z.string(), kind: z.string() }),
  properties: z.array(z.object({ id: z.number(), accountNumber: z.string(), county: z.string() })),
  envelopeId: z.number().nullable(),
  hasSigned: z.boolean(),
  signedOffline: z.boolean(),
  signedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof DocumentDto>;

export const EnvelopeDto = z.object({
  id: z.number(),
  provider: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  signerName: z.string(),
  signerEmail: z.string(),
  sentAt: z.string(),
  viewedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  events: z.array(z.object({ type: z.string(), at: z.string(), detail: z.string().optional() })),
  documents: z.array(DocumentDto),
  /** Mock provider only: the signing link, for testing without email. */
  signingUrl: z.string().nullable(),
});
export type EnvelopeDto = z.infer<typeof EnvelopeDto>;

export const DocumentListQuery = z.object({
  status: z.enum([...DOCUMENT_STATUSES, 'OPEN']).optional(),
  contactId: Id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const SendDocumentsInput = z.object({
  kinds: z.array(z.enum(DOCUMENT_KINDS)).min(1, 'Choose at least one document.'),
  propertyIds: z.array(Id).min(1, 'Choose at least one property.').max(100),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  signerName: z.string().trim().min(2, 'Enter the signer’s name.').max(120),
  signerEmail: Email,
});
export type SendDocumentsInput = z.input<typeof SendDocumentsInput>;

/** Preview one document before sending (query string version of SendDocumentsInput). */
export const PreviewDocumentQuery = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  propertyIds: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    )
    .pipe(z.array(z.number()).min(1, 'Choose at least one property.')),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  signerName: z.string().trim().min(1).max(120),
  signerEmail: z.string().trim().max(200).default(''),
});

export const DocumentTemplateDto = z.object({
  name: z.string(),
  body: z.string(),
  version: z.number(),
  isCustom: z.boolean(),
  placeholders: z.array(z.string()),
  updatedAt: z.string().nullable(),
});
export type DocumentTemplateDto = z.infer<typeof DocumentTemplateDto>;

export const SaveDocumentTemplateInput = z.object({
  body: z.string().trim().min(20, 'Write the agreement.').max(30_000),
});

/** The public signing page (mock provider). */
export const SigningSession = z.object({
  firm: z.string(),
  signerName: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  documents: z.array(z.object({ index: z.number(), title: z.string() })),
});
export type SigningSession = z.infer<typeof SigningSession>;

export const SignInput = z.object({
  signerName: z.string().trim().min(2, 'Type your full name to sign.').max(120),
  agree: z.literal(true, { message: 'Tick the box to agree.' }),
});
