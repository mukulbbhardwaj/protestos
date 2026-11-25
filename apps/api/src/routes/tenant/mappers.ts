// Database rows → API shapes. Decimals travel as strings; DATE columns as YYYY-MM-DD.
import type {
  Address,
  ContactDetail,
  ContactSummary,
  PropertySummary,
  StageEvent,
  TaxYearRecord,
} from '@app/shared';

interface DecimalLike {
  toString(): string;
  toFixed(n: number): string;
}

export const dec = (v: DecimalLike | null | undefined) => (v == null ? null : v.toString());
export const money = (v: DecimalLike | null | undefined) => (v == null ? null : v.toFixed(2));
export const iso = (v: Date | null | undefined) => (v ? v.toISOString() : null);
export const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
/** "2026-04-15" → a Date at UTC midnight, for @db.Date columns. */
export const toDay = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);

export function address(v: unknown): Address | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  return {
    line1: s('line1'),
    line2: s('line2') || null,
    city: s('city'),
    state: s('state') || 'TX',
    zip: s('zip'),
  };
}

type ContactRow = {
  id: number;
  kind: ContactSummary['kind'];
  status: ContactSummary['status'];
  clientNumber: string | null;
  displayName: string;
  entityType: ContactSummary['entityType'];
  email: string | null;
  phone: string | null;
  mailingAddress: unknown;
  source: ContactSummary['source'];
  archivedAt: Date | null;
  createdAt: Date;
  _count?: { properties: number };
};

export function toContactSummary(c: ContactRow): ContactSummary {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    clientNumber: c.clientNumber,
    displayName: c.displayName,
    entityType: c.entityType,
    email: c.email,
    phone: c.phone,
    city: address(c.mailingAddress)?.city || null,
    propertyCount: c._count?.properties ?? 0,
    source: c.source,
    archivedAt: iso(c.archivedAt),
    createdAt: c.createdAt.toISOString(),
  };
}

export function toContactDetail(
  c: ContactRow & {
    billingEmail: string | null;
    billingAddress: unknown;
    nameOnCad: string | null;
    contingencyPct: DecimalLike | null;
    flatFee: DecimalLike | null;
    bppFee: DecimalLike | null;
    notes: string | null;
    convertedAt: Date | null;
    updatedAt: Date;
  },
): ContactDetail {
  return {
    ...toContactSummary(c),
    billingEmail: c.billingEmail,
    mailingAddress: address(c.mailingAddress),
    billingAddress: address(c.billingAddress),
    nameOnCad: c.nameOnCad,
    contingencyPct: dec(c.contingencyPct),
    flatFee: money(c.flatFee),
    bppFee: money(c.bppFee),
    notes: c.notes,
    convertedAt: iso(c.convertedAt),
    updatedAt: c.updatedAt.toISOString(),
  };
}

type TaxYearRow = {
  id: number;
  taxYear: number;
  noticeLand: DecimalLike | null;
  noticeImprovement: DecimalLike | null;
  noticeMarket: DecimalLike | null;
  noticeAppraised: DecimalLike | null;
  finalLand: DecimalLike | null;
  finalImprovement: DecimalLike | null;
  finalMarket: DecimalLike | null;
  finalAppraised: DecimalLike | null;
  taxRatePct: DecimalLike | null;
  bppRenderedAt: Date | null;
  bppFee: DecimalLike | null;
  underLitigation: boolean;
  underArbitration: boolean;
  homestead: boolean;
  protestStage: TaxYearRecord['protestStage'];
  noticeReceivedAt: Date | null;
  protestFiledAt: Date | null;
  resultType: TaxYearRecord['resultType'];
  resultAt: Date | null;
  contingencyPctOverride: DecimalLike | null;
  notes: string | null;
  updatedAt: Date;
};

export function toTaxYear(t: TaxYearRow): TaxYearRecord {
  return {
    id: t.id,
    taxYear: t.taxYear,
    noticeLand: money(t.noticeLand),
    noticeImprovement: money(t.noticeImprovement),
    noticeMarket: money(t.noticeMarket),
    noticeAppraised: money(t.noticeAppraised),
    finalLand: money(t.finalLand),
    finalImprovement: money(t.finalImprovement),
    finalMarket: money(t.finalMarket),
    finalAppraised: money(t.finalAppraised),
    taxRatePct: dec(t.taxRatePct),
    bppRenderedAt: day(t.bppRenderedAt),
    bppFee: money(t.bppFee),
    underLitigation: t.underLitigation,
    underArbitration: t.underArbitration,
    homestead: t.homestead,
    protestStage: t.protestStage,
    noticeReceivedAt: day(t.noticeReceivedAt),
    protestFiledAt: day(t.protestFiledAt),
    resultType: t.resultType,
    resultAt: day(t.resultAt),
    contingencyPctOverride: dec(t.contingencyPctOverride),
    notes: t.notes,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toStageEvent(e: {
  id: number;
  fromStage: StageEvent['fromStage'];
  toStage: StageEvent['toStage'];
  note: string | null;
  at: Date;
  actor: { name: string } | null;
  taxYearRecord: { taxYear: number };
}): StageEvent {
  return {
    id: e.id,
    taxYear: e.taxYearRecord.taxYear,
    fromStage: e.fromStage,
    toStage: e.toStage,
    note: e.note,
    actor: e.actor?.name ?? null,
    at: e.at.toISOString(),
  };
}

export const propertySummaryInclude = (taxYear: number) =>
  ({
    county: { select: { id: true, name: true } },
    contact: { select: { id: true, displayName: true, clientNumber: true } },
    consultant: { select: { id: true, name: true } },
    taxYears: {
      where: { taxYear },
      select: {
        id: true,
        taxYear: true,
        protestStage: true,
        noticeAppraised: true,
        finalAppraised: true,
      },
    },
  }) as const;

export function toPropertySummary(p: {
  id: number;
  accountNumber: string;
  situsLine: string | null;
  propertyType: PropertySummary['propertyType'];
  archivedAt: Date | null;
  county: { id: number; name: string };
  contact: { id: number; displayName: string; clientNumber: string | null };
  consultant: { id: number; name: string } | null;
  taxYears: {
    id: number;
    taxYear: number;
    protestStage: TaxYearRecord['protestStage'];
    noticeAppraised: DecimalLike | null;
    finalAppraised: DecimalLike | null;
  }[];
}): PropertySummary {
  const y = p.taxYears[0];
  return {
    id: p.id,
    accountNumber: p.accountNumber,
    county: p.county,
    situsLine: p.situsLine,
    propertyType: p.propertyType,
    contact: p.contact,
    consultant: p.consultant,
    archivedAt: iso(p.archivedAt),
    year: y
      ? {
          id: y.id,
          taxYear: y.taxYear,
          protestStage: y.protestStage,
          noticeAppraised: money(y.noticeAppraised),
          finalAppraised: money(y.finalAppraised),
        }
      : null,
  };
}

/** The firm's current billing (protest) year. */
export function currentTaxYear(org: { taxYearDefault: number | null }): number {
  return org.taxYearDefault ?? new Date().getUTCFullYear();
}

/** Normalizes a CAD account number for storage and matching: trims, drops spaces. */
export function normalizeAccount(v: string): string {
  return v.trim().replace(/\s+/g, '').toUpperCase();
}
