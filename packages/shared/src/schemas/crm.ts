import { z } from 'zod';
import { DecimalString, Email, percentString } from './common.js';

export const CONTACT_KINDS = ['PROSPECT', 'CLIENT'] as const;
export const PROSPECT_STATUSES = ['NEW', 'CONTACTED', 'DOCS_SENT', 'SIGNED', 'LOST'] as const;
export const ENTITY_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export const CONTACT_SOURCES = ['WEB_FORM', 'MANUAL', 'IMPORT', 'REFERRAL'] as const;
export const PROPERTY_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'BPP', 'LAND', 'OTHER'] as const;
export const PROTEST_STAGES = [
  'NOT_STARTED',
  'AOA_SIGNED',
  'NOTICE_RECEIVED',
  'PROTEST_FILED',
  'HEARING_SCHEDULED',
  'SETTLED',
  'BOARD_ORDER',
  'NO_CHANGE',
  'WITHDRAWN',
  'INVOICED',
  'PAID',
] as const;
export const RESULT_TYPES = ['SETTLEMENT', 'BOARD_ORDER', 'NO_CHANGE', 'WITHDRAWN'] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type ProtestStage = (typeof PROTEST_STAGES)[number];

/** Stages set only by the system (invoicing M4, payments M4); never chosen by hand. */
export const SYSTEM_STAGES: readonly ProtestStage[] = ['INVOICED', 'PAID'];

// ---------------------------------------------------------------------------
// Shared pieces

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const optionalEmail = z
  .union([z.literal(''), Email])
  .transform((v) => (v === '' ? null : v))
  .nullable();

const optionalDecimal = z
  .union([z.literal(''), z.null(), DecimalString])
  .transform((v) => (v === '' || v === null ? null : v));

const optionalPercent = z
  .union([z.literal(''), z.null(), percentString('Contingency')])
  .transform((v) => (v === '' || v === null ? null : v));

export const Address = z.object({
  line1: z.string().trim().max(200).default(''),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).default(''),
  state: z.string().trim().max(2).default('TX'),
  zip: z.string().trim().max(10).default(''),
});
export type Address = z.infer<typeof Address>;

/** Server-side pagination (BUILD_PLAN 11). */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function paged<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

const csvIds = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
      : [],
  );

// ---------------------------------------------------------------------------
// Contacts (clients and prospects)

export const ContactListQuery = PageQuery.extend({
  kind: z.enum(CONTACT_KINDS).default('CLIENT'),
  status: z.enum(PROSPECT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  countyId: z.coerce.number().int().positive().optional(),
  consultantId: z.coerce.number().int().positive().optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(['name', 'clientNumber', 'newest', 'properties']).default('name'),
});
export type ContactListQuery = z.infer<typeof ContactListQuery>;

export const ContactSummary = z.object({
  id: z.number(),
  kind: z.enum(CONTACT_KINDS),
  status: z.enum(PROSPECT_STATUSES).nullable(),
  clientNumber: z.string().nullable(),
  displayName: z.string(),
  entityType: z.enum(ENTITY_TYPES),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  propertyCount: z.number(),
  source: z.enum(CONTACT_SOURCES),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ContactSummary = z.infer<typeof ContactSummary>;

export const ContactDetail = ContactSummary.extend({
  billingEmail: z.string().nullable(),
  mailingAddress: Address.nullable(),
  billingAddress: Address.nullable(),
  nameOnCad: z.string().nullable(),
  contingencyPct: z.string().nullable(),
  flatFee: z.string().nullable(),
  bppFee: z.string().nullable(),
  notes: z.string().nullable(),
  convertedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ContactDetail = z.infer<typeof ContactDetail>;

const contactFields = {
  displayName: z.string().trim().min(1, 'Enter a name.').max(200),
  entityType: z.enum(ENTITY_TYPES),
  email: optionalEmail,
  billingEmail: optionalEmail,
  phone: text(40),
  mailingAddress: Address.nullable(),
  billingAddress: Address.nullable(),
  nameOnCad: text(200),
  contingencyPct: optionalPercent,
  flatFee: optionalDecimal,
  bppFee: optionalDecimal,
  notes: text(4000),
};

export const CreateContactInput = z.object({
  kind: z.enum(CONTACT_KINDS),
  status: z.enum(PROSPECT_STATUSES).optional(),
  source: z.enum(CONTACT_SOURCES).default('MANUAL'),
  ...contactFields,
  entityType: contactFields.entityType.default('INDIVIDUAL'),
  email: contactFields.email.optional(),
  billingEmail: contactFields.billingEmail.optional(),
  phone: contactFields.phone.optional(),
  mailingAddress: contactFields.mailingAddress.optional(),
  billingAddress: contactFields.billingAddress.optional(),
  nameOnCad: contactFields.nameOnCad.optional(),
  contingencyPct: contactFields.contingencyPct.optional(),
  flatFee: contactFields.flatFee.optional(),
  bppFee: contactFields.bppFee.optional(),
  notes: contactFields.notes.optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInput>;

export const UpdateContactInput = z
  .object({ ...contactFields, status: z.enum(PROSPECT_STATUSES), source: z.enum(CONTACT_SOURCES) })
  .partial();
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

// ---------------------------------------------------------------------------
// Counties

export const CountyOption = z.object({
  id: z.number(),
  name: z.string(),
  cadName: z.string(),
  cadWebsite: z.string().nullable(),
});
export type CountyOption = z.infer<typeof CountyOption>;

// ---------------------------------------------------------------------------
// Properties

export const PropertyListQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  countyId: z.coerce.number().int().positive().optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  consultantId: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
  contactId: z.coerce.number().int().positive().optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  stage: z.enum(PROTEST_STAGES).optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(['account', 'owner', 'county', 'newest', 'value']).default('owner'),
});
export type PropertyListQuery = z.infer<typeof PropertyListQuery>;

export const PropertySummary = z.object({
  id: z.number(),
  accountNumber: z.string(),
  county: z.object({ id: z.number(), name: z.string() }),
  situsLine: z.string().nullable(),
  propertyType: z.enum(PROPERTY_TYPES),
  contact: z.object({
    id: z.number(),
    displayName: z.string(),
    clientNumber: z.string().nullable(),
  }),
  consultant: z.object({ id: z.number(), name: z.string() }).nullable(),
  archivedAt: z.string().nullable(),
  /** The record for the requested (or firm default) tax year, if any. */
  year: z
    .object({
      id: z.number(),
      taxYear: z.number(),
      protestStage: z.enum(PROTEST_STAGES),
      noticeAppraised: z.string().nullable(),
      finalAppraised: z.string().nullable(),
    })
    .nullable(),
});
export type PropertySummary = z.infer<typeof PropertySummary>;

export const TaxYearRecord = z.object({
  id: z.number(),
  taxYear: z.number(),
  noticeLand: z.string().nullable(),
  noticeImprovement: z.string().nullable(),
  noticeMarket: z.string().nullable(),
  noticeAppraised: z.string().nullable(),
  finalLand: z.string().nullable(),
  finalImprovement: z.string().nullable(),
  finalMarket: z.string().nullable(),
  finalAppraised: z.string().nullable(),
  taxRatePct: z.string().nullable(),
  bppRenderedAt: z.string().nullable(),
  bppFee: z.string().nullable(),
  underLitigation: z.boolean(),
  underArbitration: z.boolean(),
  homestead: z.boolean(),
  protestStage: z.enum(PROTEST_STAGES),
  noticeReceivedAt: z.string().nullable(),
  protestFiledAt: z.string().nullable(),
  resultType: z.enum(RESULT_TYPES).nullable(),
  resultAt: z.string().nullable(),
  contingencyPctOverride: z.string().nullable(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});
export type TaxYearRecord = z.infer<typeof TaxYearRecord>;

export const StageEvent = z.object({
  id: z.number(),
  taxYear: z.number(),
  fromStage: z.enum(PROTEST_STAGES).nullable(),
  toStage: z.enum(PROTEST_STAGES),
  note: z.string().nullable(),
  actor: z.string().nullable(),
  at: z.string(),
});
export type StageEvent = z.infer<typeof StageEvent>;

/** What the fee preview needs, beyond the tax-year values. */
export const FeeContext = z.object({
  savingsBasis: z.enum(['APPRAISED', 'MARKET']),
  flatFeeCurrentYearOnly: z.boolean(),
  currentTaxYear: z.number(),
  firm: z.object({
    defaultContingencyPct: z.string(),
    defaultFlatFee: z.string(),
    defaultBppFee: z.string(),
  }),
  client: z.object({
    contingencyPct: z.string().nullable(),
    flatFee: z.string().nullable(),
    bppFee: z.string().nullable(),
  }),
  property: z.object({
    contingencyPct: z.string().nullable(),
    flatFee: z.string().nullable(),
    bppFee: z.string().nullable(),
  }),
});
export type FeeContext = z.infer<typeof FeeContext>;

export const PropertyDetail = PropertySummary.omit({ year: true }).extend({
  county: CountyOption,
  situsAddress: Address.nullable(),
  contingencyPct: z.string().nullable(),
  flatFee: z.string().nullable(),
  bppFee: z.string().nullable(),
  notes: z.string().nullable(),
  archivedWithContact: z.boolean(),
  createdAt: z.string(),
  taxYears: z.array(TaxYearRecord),
  stageEvents: z.array(StageEvent),
  feeContext: FeeContext,
});
export type PropertyDetail = z.infer<typeof PropertyDetail>;

export const CreatePropertyInput = z.object({
  contactId: z.coerce.number().int().positive(),
  accountNumber: z.string().trim().min(1, 'Enter the CAD account number.').max(40),
  countyId: z.coerce.number().int().positive({ message: 'Choose a county.' }),
  situsAddress: Address.nullable().optional(),
  propertyType: z.enum(PROPERTY_TYPES).default('RESIDENTIAL'),
  consultantUserId: z.coerce.number().int().positive().nullable().optional(),
  contingencyPct: optionalPercent.optional(),
  flatFee: optionalDecimal.optional(),
  bppFee: optionalDecimal.optional(),
  notes: text(4000).optional(),
  /** Create an empty record for this tax year too. */
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type CreatePropertyInput = z.infer<typeof CreatePropertyInput>;

export const UpdatePropertyInput = CreatePropertyInput.omit({ contactId: true, taxYear: true })
  .extend({
    situsAddress: Address.nullable(),
    consultantUserId: z.coerce.number().int().positive().nullable(),
  })
  .partial();
export type UpdatePropertyInput = z.infer<typeof UpdatePropertyInput>;

const optionalDate = z
  .union([z.literal(''), z.null(), z.iso.date('Use a date like 2026-04-15.')])
  .transform((v) => (v === '' || v === null ? null : v));

export const UpdateTaxYearInput = z
  .object({
    noticeLand: optionalDecimal,
    noticeImprovement: optionalDecimal,
    noticeMarket: optionalDecimal,
    noticeAppraised: optionalDecimal,
    finalLand: optionalDecimal,
    finalImprovement: optionalDecimal,
    finalMarket: optionalDecimal,
    finalAppraised: optionalDecimal,
    taxRatePct: optionalDecimal,
    bppRenderedAt: optionalDate,
    bppFee: optionalDecimal,
    underLitigation: z.boolean(),
    underArbitration: z.boolean(),
    homestead: z.boolean(),
    noticeReceivedAt: optionalDate,
    protestFiledAt: optionalDate,
    resultType: z.enum(RESULT_TYPES).nullable(),
    resultAt: optionalDate,
    contingencyPctOverride: optionalPercent,
    notes: text(4000),
  })
  .partial();
export type UpdateTaxYearInput = z.infer<typeof UpdateTaxYearInput>;

export const CreateTaxYearInput = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100),
});

export const ChangeStageInput = z.object({
  stage: z.enum(PROTEST_STAGES).refine((s) => !SYSTEM_STAGES.includes(s), {
    message: 'Invoiced and paid are set automatically by invoices and payments.',
  }),
  note: text(1000).optional(),
});
export type ChangeStageInput = z.infer<typeof ChangeStageInput>;

export const BulkPropertyIds = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
});
export const BulkAssignInput = BulkPropertyIds.extend({
  consultantUserId: z.number().int().positive().nullable(),
});
export const BulkStageInput = BulkPropertyIds.extend({
  taxYear: z.number().int().min(2000).max(2100),
  stage: ChangeStageInput.shape.stage,
});
export const BulkRolloverInput = BulkPropertyIds.extend({
  taxYear: z.number().int().min(2000).max(2100),
});
export const BulkResult = z.object({ updated: z.number(), skipped: z.number() });

// ---------------------------------------------------------------------------
// Search and dashboard

export const SearchResults = z.object({
  contacts: z.array(
    z.object({
      id: z.number(),
      kind: z.enum(CONTACT_KINDS),
      displayName: z.string(),
      clientNumber: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  properties: z.array(
    z.object({
      id: z.number(),
      accountNumber: z.string(),
      county: z.string(),
      situsLine: z.string().nullable(),
      owner: z.string(),
    }),
  ),
});
export type SearchResults = z.infer<typeof SearchResults>;

export const DashboardStats = z.object({
  taxYear: z.number(),
  activeClients: z.number(),
  propertiesThisYear: z.number(),
  newProspects30d: z.number(),
  myProperties: z.number(),
  /** Bounced emails in the last 30 days (M5): shown as a dashboard alert. */
  bouncedEmails: z.number(),
  /** M7: hearings today and in the next 7 days, and documents waiting for a signature. */
  hearingsToday: z.number(),
  hearingsThisWeek: z.number(),
  documentsAwaitingSignature: z.number(),
  stages: z.array(z.object({ stage: z.enum(PROTEST_STAGES), count: z.number() })),
});
export type DashboardStats = z.infer<typeof DashboardStats>;

export { csvIds };
