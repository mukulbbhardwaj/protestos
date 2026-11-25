import { fromScaled, mulDivRound, toScaled, type DecimalLike } from '../fees/decimal.js';

// Equity (unequal appraisal) estimate, Texas Tax Code §42.26(a)(3). Spec:
// docs/specs/savings-calculator.md sections 5 and 5a. Pure: no I/O, same answer in the browser
// and the API.

export interface EstimateParcel {
  accountNumber: string;
  situsLine: string | null;
  landValue: DecimalLike | null;
  improvementValue: DecimalLike | null;
  marketValue: DecimalLike | null;
  appraisedValue: DecimalLike | null;
  /** Living area for homes; building area for commercial property. */
  livingAreaSqft: number | null;
  yearBuilt: number | null;
  qualityCode: string | null;
  /** Needed when a pass is limited to the subject's neighborhood (commercial). */
  neighborhoodCode?: string | null;
  /** Building type (office, retail …); commercial comparables must match it. */
  propertyUse?: string | null;
}

export type PropertyKind = 'RESIDENTIAL' | 'COMMERCIAL';

/** State class F (commercial and industrial real property) uses the commercial rules. */
export function propertyKindOf(stateClass: string): PropertyKind {
  return stateClass.toUpperCase().startsWith('F') ? 'COMMERCIAL' : 'RESIDENTIAL';
}

export type TaxUnitKind = 'SCHOOL' | 'COUNTY' | 'CITY' | 'OTHER';

export interface EstimateTaxUnit {
  code: string;
  name: string;
  kind: TaxUnitKind;
  /** Rate as a percentage: 1.0 means 1%. Null when the CAD hasn't published it. */
  ratePct: DecimalLike | null;
  /** The account's taxable value in this unit (after exemptions). */
  taxableValue: DecimalLike;
  /** Percentage exemption in this unit (e.g. a 20% local homestead), 0 when none. */
  exemptPct?: DecimalLike;
}

export interface EstimateInput {
  /** Which comparable rules apply (spec section 5 or 5a). Defaults to RESIDENTIAL. */
  kind?: PropertyKind;
  subject: EstimateParcel & {
    /** Over-65 or disabled homestead: school taxes are frozen (§11.26). */
    taxCeiling: boolean;
  };
  /**
   * Same county, year and state class; same neighborhood for homes, same market area for
   * commercial. The subject may be included; it is skipped.
   */
  candidates: EstimateParcel[];
  /** The subject's taxing units. Empty when the county has no per-unit data. */
  units: EstimateTaxUnit[];
  /** Combined rate used when no unit has a rate. */
  fallbackTaxRatePct?: DecimalLike | null;
  contingencyPct: DecimalLike;
}

export type EstimateStatus =
  'ESTIMATE' | 'NO_REDUCTION' | 'INSUFFICIENT_COMPS' | 'INCOMPLETE_SUBJECT';
export type EstimateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EstimateComp {
  accountNumber: string;
  situsLine: string | null;
  livingAreaSqft: number;
  yearBuilt: number | null;
  qualityCode: string | null;
  landValue: string;
  improvementValue: string;
  marketValue: string;
  /** Improvement value per square foot, to the cent. */
  improvementPerSqft: string;
  /** Subject land + comp improvement rate × subject area, whole dollars. */
  adjustedValue: string;
}

export interface EstimateUnitSavings {
  code: string;
  name: string;
  kind: TaxUnitKind;
  ratePct: string;
  taxableReduction: string;
  savings: string;
  /** Why this unit saves nothing, when it doesn't. */
  note: string | null;
}

export interface EstimateResult {
  status: EstimateStatus;
  confidence: EstimateConfidence | null;
  /** True when the wide pass had to be used. */
  widened: boolean;
  comps: EstimateComp[];
  /** Coefficient of dispersion of the adjusted values around the median, in percent. */
  dispersionPct: string | null;
  indicatedValue: string | null;
  marketReduction: string | null;
  newMarket: string | null;
  newAppraised: string | null;
  appraisedReduction: string | null;
  units: EstimateUnitSavings[];
  /** Annual tax savings; null when there is no rate to compute it with. */
  taxSavings: string | null;
  contingencyPct: string;
  firmFee: string | null;
  clientKeeps: string | null;
  warnings: string[];
  explanation: string[];
}

export const MIN_COMPS = 5;
export const MAX_COMPS = 15;
const HIGH_CONFIDENCE_COMPS = 10;

interface Pass {
  areaPct: number;
  years: number;
  sameGrade: boolean;
  sameNeighborhood: boolean;
  sameUse: boolean;
}

interface Rules {
  strict: Pass;
  wide: Pass;
  /** Highest dispersion (percent) for high confidence. */
  highConfidenceDispersion: bigint;
  one: string;
  many: string;
}

export const RULES: Record<PropertyKind, Rules> = {
  RESIDENTIAL: {
    strict: { areaPct: 25, years: 15, sameGrade: true, sameNeighborhood: true, sameUse: false },
    wide: { areaPct: 40, years: 30, sameGrade: false, sameNeighborhood: true, sameUse: false },
    highConfidenceDispersion: 15n,
    one: 'home',
    many: 'homes',
  },
  // Commercial property is sparse: wider bands, building type must match, and the wide pass
  // reaches the CAD's market area (spec section 5a).
  COMMERCIAL: {
    strict: { areaPct: 50, years: 25, sameGrade: false, sameNeighborhood: true, sameUse: true },
    wide: { areaPct: 75, years: 40, sameGrade: false, sameNeighborhood: false, sameUse: true },
    highConfidenceDispersion: 20n,
    one: 'property',
    many: 'properties',
  },
};
export const STRICT_PASS = RULES.RESIDENTIAL.strict;
export const WIDE_PASS = RULES.RESIDENTIAL.wide;

const CENTS = 2;
const RATE = 4;
const RATE_DIVISOR = 100n * 10n ** BigInt(RATE);
const DOLLAR = 100n; // cents per dollar

const isSet = (v: DecimalLike | null | undefined): v is DecimalLike =>
  v !== null && v !== undefined && v !== '';

const cents = (v: DecimalLike) => toScaled(v, CENTS);
const money = (c: bigint) => fromScaled(c, CENTS);

/** $312,400 or $1,234.56. Amounts here are never negative. */
function usd(c: bigint): string {
  const [int, frac] = fromScaled(c, CENTS).split('.') as [string, string];
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac === '00' ? '' : `.${frac}`}`;
}

function pct(scaled: bigint): string {
  return `${fromScaled(scaled, RATE).replace(/\.?0+$/, '')}%`;
}

/** Rounds cents to whole dollars, half up (values here are never negative). */
const toDollars = (c: bigint) => mulDivRound(c, 1n, DOLLAR) * DOLLAR;

interface Usable {
  parcel: EstimateParcel;
  area: number;
  land: bigint;
  improvement: bigint;
  market: bigint;
}

function usable(p: EstimateParcel): Usable | null {
  if (!p.livingAreaSqft || p.livingAreaSqft <= 0) return null;
  if (!isSet(p.landValue) || !isSet(p.improvementValue) || !isSet(p.marketValue)) return null;
  const market = cents(p.marketValue);
  if (market <= 0n) return null;
  return {
    parcel: p,
    area: p.livingAreaSqft,
    land: cents(p.landValue),
    improvement: cents(p.improvementValue),
    market,
  };
}

function similarity(subject: EstimateParcel, comp: EstimateParcel, area: number): number {
  const subjectArea = subject.livingAreaSqft!;
  const yearGap =
    subject.yearBuilt !== null && comp.yearBuilt !== null
      ? Math.abs(subject.yearBuilt - comp.yearBuilt)
      : 15;
  const gradeGap = subject.qualityCode === comp.qualityCode ? 0 : 0.5;
  return Math.abs(area - subjectArea) / subjectArea + yearGap / 30 + gradeGap;
}

function select(subject: EstimateParcel, candidates: Usable[], pass: Pass): Usable[] {
  const area = subject.livingAreaSqft!;
  return candidates
    .filter((c) => {
      if (Math.abs(c.area - area) * 100 > area * pass.areaPct) return false;
      if (subject.yearBuilt !== null && c.parcel.yearBuilt !== null) {
        if (Math.abs(c.parcel.yearBuilt - subject.yearBuilt) > pass.years) return false;
      }
      if (pass.sameGrade && c.parcel.qualityCode !== subject.qualityCode) return false;
      if (pass.sameUse && (c.parcel.propertyUse ?? null) !== (subject.propertyUse ?? null)) {
        return false;
      }
      const hood = subject.neighborhoodCode ?? null;
      if (pass.sameNeighborhood && hood !== null && (c.parcel.neighborhoodCode ?? hood) !== hood) {
        return false;
      }
      return true;
    })
    .map((c) => ({ c, score: similarity(subject, c.parcel, c.area) }))
    .sort(
      (a, b) =>
        a.score - b.score || a.c.parcel.accountNumber.localeCompare(b.c.parcel.accountNumber),
    )
    .slice(0, MAX_COMPS)
    .map(({ c }) => c);
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return mulDivRound(sorted[mid - 1]! + sorted[mid]!, 1n, 2n);
}

/** Average absolute deviation from the median, as a percent of the median (scaled at RATE). */
function dispersion(values: bigint[], mid: bigint): bigint {
  if (mid === 0n) return 0n;
  const total = values.reduce((sum, v) => sum + (v > mid ? v - mid : mid - v), 0n);
  return mulDivRound(total, RATE_DIVISOR, mid * BigInt(values.length));
}

function empty(
  status: EstimateStatus,
  contingencyPct: bigint,
  warnings: string[],
  explanation: string[],
): EstimateResult {
  return {
    status,
    confidence: null,
    widened: false,
    comps: [],
    dispersionPct: null,
    indicatedValue: null,
    marketReduction: null,
    newMarket: null,
    newAppraised: null,
    appraisedReduction: null,
    units: [],
    taxSavings: null,
    contingencyPct: fromScaled(contingencyPct, RATE),
    firmFee: null,
    clientKeeps: null,
    warnings,
    explanation,
  };
}

export function estimateSavings(input: EstimateInput): EstimateResult {
  const warnings: string[] = [];
  const explanation: string[] = [];
  const contingencyPct = toScaled(input.contingencyPct, RATE);
  const { subject } = input;
  const commercial = input.kind === 'COMMERCIAL';
  const rules = RULES[input.kind ?? 'RESIDENTIAL'];

  const subj = usable(subject);
  if (!subj || !isSet(subject.appraisedValue)) {
    explanation.push(
      `The appraisal district record for this account is missing its values or ${commercial ? 'building' : 'living'} area, so it can’t be estimated.`,
    );
    return empty('INCOMPLETE_SUBJECT', contingencyPct, warnings, explanation);
  }
  const appraised = cents(subject.appraisedValue);

  const pool = input.candidates
    .filter((c) => c.accountNumber !== subject.accountNumber)
    .map(usable)
    .filter((c): c is Usable => c !== null);

  let widened = false;
  let chosen = select(subject, pool, rules.strict);
  const strictCount = chosen.length;
  if (chosen.length < MIN_COMPS) {
    widened = true;
    chosen = select(subject, pool, rules.wide);
  }
  if (chosen.length < MIN_COMPS) {
    explanation.push(
      `Only ${chosen.length} comparable ${chosen.length === 1 ? rules.one : rules.many} found ${commercial ? 'in this market area' : 'in this neighborhood'}; at least ${MIN_COMPS} are needed for an estimate.`,
    );
    return empty('INSUFFICIENT_COMPS', contingencyPct, warnings, explanation);
  }

  const comps: EstimateComp[] = [];
  const adjusted: bigint[] = [];
  for (const c of chosen) {
    const value = toDollars(
      subj.land + mulDivRound(c.improvement, BigInt(subj.area), BigInt(c.area)),
    );
    adjusted.push(value);
    comps.push({
      accountNumber: c.parcel.accountNumber,
      situsLine: c.parcel.situsLine,
      livingAreaSqft: c.area,
      yearBuilt: c.parcel.yearBuilt,
      qualityCode: c.parcel.qualityCode,
      landValue: money(c.land),
      improvementValue: money(c.improvement),
      marketValue: money(c.market),
      improvementPerSqft: money(mulDivRound(c.improvement, 1n, BigInt(c.area))),
      adjustedValue: money(value),
    });
  }

  const indicated = toDollars(median(adjusted));
  const spread = dispersion(adjusted, indicated);
  const confidence: EstimateConfidence = widened
    ? 'LOW'
    : strictCount >= HIGH_CONFIDENCE_COMPS &&
        spread < rules.highConfidenceDispersion * 10n ** BigInt(RATE)
      ? 'HIGH'
      : 'MEDIUM';
  if (widened) {
    warnings.push(
      commercial
        ? 'Few close matches in this neighborhood, so the search was widened to the same building type across the market area. Treat this as a rough estimate.'
        : 'Few close matches nearby, so the search was widened to homes of more varied size, age and grade. Treat this as a rough estimate.',
    );
  }

  const marketReduction = subj.market > indicated ? subj.market - indicated : 0n;
  const newMarket = subj.market - marketReduction;
  const newAppraised = appraised < newMarket ? appraised : newMarket;
  const appraisedReduction = appraised - newAppraised;

  explanation.push(
    commercial
      ? `Median of ${comps.length} comparable ${subject.propertyUse ?? 'commercial'} properties, adjusted to this property’s land and building size: ${usd(indicated)}`
      : `Median of ${comps.length} neighbors, adjusted to this home’s land and size: ${usd(indicated)}`,
  );
  explanation.push(
    `Market value ${usd(subj.market)} − indicated ${usd(indicated)} = reduction ${usd(marketReduction)}`,
  );
  if (appraised < subj.market) {
    explanation.push(
      `Appraised (capped) value ${usd(appraised)} → ${usd(newAppraised)}: reduction ${usd(appraisedReduction)}`,
    );
  }

  const base = {
    confidence,
    widened,
    comps,
    dispersionPct: fromScaled(spread, RATE),
    indicatedValue: money(indicated),
    marketReduction: money(marketReduction),
    newMarket: money(newMarket),
    newAppraised: money(newAppraised),
    appraisedReduction: money(appraisedReduction),
    contingencyPct: fromScaled(contingencyPct, RATE),
  };

  if (appraisedReduction === 0n) {
    explanation.push(
      marketReduction > 0n
        ? 'The market value looks high, but the capped appraised value is already below the indicated value, so a protest would not lower this year’s tax.'
        : `The appraisal is in line with comparable ${commercial ? 'properties' : 'neighbors'}, so an equity protest is unlikely to lower it.`,
    );
    return {
      ...base,
      status: 'NO_REDUCTION',
      units: [],
      taxSavings: '0.00',
      firmFee: '0.00',
      clientKeeps: '0.00',
      warnings,
      explanation,
    };
  }

  const units: EstimateUnitSavings[] = [];
  let taxSavings: bigint | null = null;
  const rated = input.units.filter((u) => isSet(u.ratePct));
  if (rated.length > 0) {
    if (rated.length < input.units.length) {
      warnings.push('Some taxing units have no published rate yet, so the savings may be low.');
    }
    taxSavings = 0n;
    for (const u of rated) {
      const rate = toScaled(u.ratePct!, RATE);
      const exempt = toScaled(u.exemptPct ?? 0, RATE);
      const share = mulDivRound(appraisedReduction, RATE_DIVISOR - exempt, RATE_DIVISOR);
      const taxable = cents(u.taxableValue);
      const reduction = share < taxable ? share : taxable;
      const frozen = input.subject.taxCeiling && u.kind === 'SCHOOL';
      const saved = frozen ? 0n : mulDivRound(reduction, rate, RATE_DIVISOR);
      taxSavings += saved;
      units.push({
        code: u.code,
        name: u.name,
        kind: u.kind,
        ratePct: fromScaled(rate, RATE),
        taxableReduction: money(reduction),
        savings: money(saved),
        note: frozen
          ? 'School taxes are frozen (over-65 or disabled ceiling).'
          : reduction === 0n
            ? 'Already fully exempt in this unit.'
            : null,
      });
    }
    explanation.push(`Tax savings across ${units.length} taxing units: ${usd(taxSavings)} a year`);
  } else if (isSet(input.fallbackTaxRatePct)) {
    const rate = toScaled(input.fallbackTaxRatePct, RATE);
    taxSavings = mulDivRound(appraisedReduction, rate, RATE_DIVISOR);
    warnings.push('Per-unit tax rates aren’t available, so one combined rate was used.');
    explanation.push(
      `Reduction ${usd(appraisedReduction)} × ${pct(rate)} = ${usd(taxSavings)} a year`,
    );
  } else {
    warnings.push('No tax rate is available for this account, so savings can’t be computed.');
  }

  let firmFee: bigint | null = null;
  if (taxSavings !== null) {
    firmFee = mulDivRound(taxSavings, contingencyPct, RATE_DIVISOR);
    explanation.push(
      `Firm fee ${pct(contingencyPct)} of ${usd(taxSavings)} = ${usd(firmFee)}; client keeps ${usd(taxSavings - firmFee)}`,
    );
  }

  return {
    ...base,
    status: 'ESTIMATE',
    units,
    taxSavings: taxSavings === null ? null : money(taxSavings),
    firmFee: firmFee === null ? null : money(firmFee),
    clientKeeps: taxSavings === null || firmFee === null ? null : money(taxSavings - firmFee),
    warnings,
    explanation,
  };
}
