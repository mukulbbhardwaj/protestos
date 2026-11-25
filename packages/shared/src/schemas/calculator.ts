import { z } from 'zod';
import { Email, percentString } from './common.js';

// Savings calculator API (docs/specs/savings-calculator.md section 6).

const TaxYear = z.coerce.number().int().min(2000).max(2100);
const CountyId = z.coerce.number().int().positive();

export const CalculatorCoverage = z.array(
  z.object({ countyId: z.number(), countyName: z.string(), taxYears: z.array(z.number()) }),
);
export type CalculatorCoverage = z.infer<typeof CalculatorCoverage>;

export const CalculatorSearchQuery = z.object({
  countyId: CountyId,
  taxYear: TaxYear,
  q: z.string().trim().min(2, 'Type at least 2 characters.').max(100),
});

export const CadParcelSummary = z.object({
  accountNumber: z.string(),
  ownerName: z.string().nullable(),
  situsLine: z.string().nullable(),
  situsZip: z.string().nullable(),
  stateClass: z.string(),
  marketValue: z.string(),
  appraisedValue: z.string(),
});
export type CadParcelSummary = z.infer<typeof CadParcelSummary>;

export const CadParcelDetail = CadParcelSummary.extend({
  kind: z.enum(['RESIDENTIAL', 'COMMERCIAL']),
  neighborhoodCode: z.string(),
  marketArea: z.string().nullable(),
  /** Building type, for commercial property. */
  propertyUse: z.string().nullable(),
  landValue: z.string(),
  improvementValue: z.string(),
  livingAreaSqft: z.number().nullable(),
  yearBuilt: z.number().nullable(),
  qualityCode: z.string().nullable(),
  homestead: z.boolean(),
  taxCeiling: z.boolean(),
});
export type CadParcelDetail = z.infer<typeof CadParcelDetail>;

export const CalculatorEstimateQuery = z.object({
  countyId: CountyId,
  taxYear: TaxYear,
  account: z.string().trim().min(1).max(40),
  /** "What if" contingency; not saved anywhere. */
  contingencyPct: z
    .union([z.literal(''), percentString('Contingency')])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

const TAX_UNIT_KINDS = ['SCHOOL', 'COUNTY', 'CITY', 'OTHER'] as const;

/** Mirrors EstimateResult from the estimate engine. */
export const EstimateResultSchema = z.object({
  status: z.enum(['ESTIMATE', 'NO_REDUCTION', 'INSUFFICIENT_COMPS', 'INCOMPLETE_SUBJECT']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable(),
  widened: z.boolean(),
  comps: z.array(
    z.object({
      accountNumber: z.string(),
      situsLine: z.string().nullable(),
      livingAreaSqft: z.number(),
      yearBuilt: z.number().nullable(),
      qualityCode: z.string().nullable(),
      landValue: z.string(),
      improvementValue: z.string(),
      marketValue: z.string(),
      improvementPerSqft: z.string(),
      adjustedValue: z.string(),
    }),
  ),
  dispersionPct: z.string().nullable(),
  indicatedValue: z.string().nullable(),
  marketReduction: z.string().nullable(),
  newMarket: z.string().nullable(),
  newAppraised: z.string().nullable(),
  appraisedReduction: z.string().nullable(),
  units: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.enum(TAX_UNIT_KINDS),
      ratePct: z.string(),
      taxableReduction: z.string(),
      savings: z.string(),
      note: z.string().nullable(),
    }),
  ),
  taxSavings: z.string().nullable(),
  contingencyPct: z.string(),
  firmFee: z.string().nullable(),
  clientKeeps: z.string().nullable(),
  warnings: z.array(z.string()),
  explanation: z.array(z.string()),
});

export const CalculatorEstimate = z.object({
  county: z.object({ id: z.number(), name: z.string() }),
  taxYear: z.number(),
  parcel: CadParcelDetail,
  estimate: EstimateResultSchema,
  /** Where the contingency % came from. WHAT_IF means the caller supplied it. */
  contingencySource: z.enum(['TAX_YEAR', 'PROPERTY', 'CLIENT', 'FIRM', 'WHAT_IF']),
  /** The firm's own property for this account, if it has one. */
  /** Archived properties count: the account is still the firm's, so it isn't offered again. */
  property: z
    .object({
      id: z.number(),
      contactId: z.number(),
      contactName: z.string(),
      archived: z.boolean(),
    })
    .nullable(),
});
export type CalculatorEstimate = z.infer<typeof CalculatorEstimate>;

export const CreateProspectFromParcelInput = z.object({
  countyId: CountyId,
  taxYear: TaxYear,
  account: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1, 'Enter a name.').max(200),
  email: z
    .union([z.literal(''), Email])
    .optional()
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
});
export type CreateProspectFromParcelInput = z.infer<typeof CreateProspectFromParcelInput>;

export const CreatedFromParcel = z.object({ contactId: z.number(), propertyId: z.number() });

// ---------------------------------------------------------------------------
// Browse: filter the county roll (spec section 7, "Browse")

const optionalInt = (min: number, max: number) =>
  z
    .union([z.literal(''), z.coerce.number().int().min(min).max(max)])
    .optional()
    .transform((v) => (v === '' ? undefined : v));
const optionalText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || undefined);
const yesNo = z
  .enum(['yes', 'no', ''])
  .optional()
  .transform((v) => v || undefined);

export const CALCULATOR_SORTS = ['equity', 'market', 'area', 'year', 'address'] as const;

export const CalculatorBrowseQuery = z.object({
  countyId: CountyId,
  taxYear: TaxYear,
  // Deep offsets scan millions of rows; past page 200, filters are the way to narrow.
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  kind: z
    .enum(['RESIDENTIAL', 'COMMERCIAL', ''])
    .optional()
    .transform((v) => v || undefined),
  propertyUse: optionalText,
  neighborhood: optionalText,
  zip: optionalText,
  grade: optionalText,
  minMarket: optionalInt(0, 10_000_000_000),
  maxMarket: optionalInt(0, 10_000_000_000),
  minArea: optionalInt(0, 10_000_000),
  maxArea: optionalInt(0, 10_000_000),
  minYear: optionalInt(1800, 2100),
  maxYear: optionalInt(1800, 2100),
  homestead: yesNo,
  over65: yesNo,
  /** Appraised at least this many percent above comparable neighbors per sq ft. */
  minEquityPct: optionalInt(-100, 1000),
  sort: z.enum(CALCULATOR_SORTS).default('equity'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type CalculatorBrowseQuery = z.infer<typeof CalculatorBrowseQuery>;

export const CadParcelRow = CadParcelSummary.extend({
  kind: z.enum(['RESIDENTIAL', 'COMMERCIAL']),
  propertyUse: z.string().nullable(),
  neighborhoodCode: z.string(),
  livingAreaSqft: z.number().nullable(),
  yearBuilt: z.number().nullable(),
  qualityCode: z.string().nullable(),
  improvementPerSqft: z.string().nullable(),
  /** Percent above (+) or below (−) comparable neighbors per sq ft; null when not computed. */
  equityPct: z.number().nullable(),
  homestead: z.boolean(),
  taxCeiling: z.boolean(),
});
export type CadParcelRow = z.infer<typeof CadParcelRow>;

export const CalculatorBrowseResult = z.object({
  items: z.array(CadParcelRow),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type CalculatorBrowseResult = z.infer<typeof CalculatorBrowseResult>;

export const CalculatorFacets = z.object({
  propertyUses: z.array(z.string()),
  grades: z.array(z.string()),
});
export type CalculatorFacets = z.infer<typeof CalculatorFacets>;
