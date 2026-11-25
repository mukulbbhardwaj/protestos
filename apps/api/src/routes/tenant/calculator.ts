import {
  CadParcelSummary,
  CalculatorBrowseQuery,
  CalculatorBrowseResult,
  CalculatorFacets,
  CalculatorCoverage,
  CalculatorEstimate,
  CalculatorEstimateQuery,
  CalculatorSearchQuery,
  CreatedFromParcel,
  CreateProspectFromParcelInput,
  estimateSavings,
  propertyKindOf,
  resolveFeeTerms,
  RULES,
  type EstimateTaxUnit,
  type TaxUnitKind,
} from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@app/db';
import { z } from 'zod';
import { conflict, notFound } from '../../errors.js';
import type { TenantContext } from '../../plugins/context.js';
import { requireRole, tenantOf } from '../../plugins/tenant.js';
import { recordAudit } from '../../services/audit.js';
import { dec, money } from './mappers.js';
import { actorOf, OrgParams } from './params.js';

// Savings calculator (docs/specs/savings-calculator.md). The CAD roll is public reference
// data shared by every firm; what is firm-specific is the fee terms and the link to the
// firm's own property, both read through the org-scoped db.

type Db = TenantContext['db'];

/** CAD roll account numbers carry no spaces or dashes. */
const rollAccount = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();

/**
 * The smallest string above every string starting with `prefix`, for an indexable prefix range
 * that holds under any collation: bump the last character within [0-9A-Z], carrying ("0039" →
 * "004"). Null when there is no upper bound ("ZZ").
 */
function prefixUpperBound(prefix: string): string | null {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = prefix.length - 1; i >= 0; i--) {
    const at = alphabet.indexOf(prefix[i]!);
    if (at >= 0 && at < alphabet.length - 1) return prefix.slice(0, i) + alphabet[at + 1];
  }
  return null;
}

/**
 * The firm's property for a roll account. Firms may have typed the account with dashes
 * ("066-064-013-0039"); the roll has none, so compare with dashes and spaces removed. Narrowed
 * by first character, then matched exactly in memory. Archived properties count too.
 */
async function findFirmProperty(db: Db, countyId: number, account: string) {
  const rows = await db.property.findMany({
    where: { countyId, accountNumber: { startsWith: account.slice(0, 1), mode: 'insensitive' } },
    select: { id: true, accountNumber: true },
  });
  return rows.find((r) => rollAccount(r.accountNumber) === account) ?? null;
}

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

const summarySelect = {
  accountNumber: true,
  ownerName: true,
  situsLine: true,
  situsZip: true,
  stateClass: true,
  marketValue: true,
  appraisedValue: true,
} as const;

interface StoredUnit {
  code: string;
  taxableValue: string | number;
  exemptPct?: string | number;
}

async function findParcel(db: Db, countyId: number, taxYear: number, account: string) {
  const parcel = await db.cadParcel.findUnique({
    where: {
      countyId_taxYear_accountNumber: { countyId, taxYear, accountNumber: rollAccount(account) },
    },
    include: { county: { select: { id: true, name: true } } },
  });
  if (!parcel) {
    throw notFound('That account isn’t on the loaded appraisal roll for this county and year.');
  }
  return parcel;
}

/**
 * Per county-year values that change only when the roll is reloaded or re-indexed. Keyed by
 * county:year (so the map stays bounded) and checked against the load's `loadedAt`.
 */
const rollCache = new Map<
  string,
  { loadedAt: string; facets?: CalculatorFacets; indexedCount?: number }
>();
function rollCacheEntry(countyId: number, taxYear: number, loadedAt: Date) {
  const key = `${countyId}:${taxYear}`;
  let entry = rollCache.get(key);
  if (!entry || entry.loadedAt !== loadedAt.toISOString()) {
    entry = { loadedAt: loadedAt.toISOString() };
    rollCache.set(key, entry);
  }
  return entry;
}

function browseWhere(q: CalculatorBrowseQuery): Prisma.CadParcelWhereInput {
  const range = (min?: number, max?: number) =>
    min === undefined && max === undefined
      ? undefined
      : { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) };
  return {
    countyId: q.countyId,
    taxYear: q.taxYear,
    ...(q.kind === 'COMMERCIAL' ? { stateClass: { startsWith: 'F' } } : {}),
    ...(q.kind === 'RESIDENTIAL' ? { NOT: { stateClass: { startsWith: 'F' } } } : {}),
    ...(q.propertyUse ? { propertyUse: q.propertyUse } : {}),
    ...(q.neighborhood
      ? { neighborhoodCode: { equals: q.neighborhood, mode: 'insensitive' } }
      : {}),
    ...(q.zip ? { situsZip: { startsWith: q.zip } } : {}),
    ...(q.grade ? { qualityCode: q.grade } : {}),
    ...(range(q.minMarket, q.maxMarket) ? { marketValue: range(q.minMarket, q.maxMarket) } : {}),
    ...(range(q.minArea, q.maxArea) ? { livingAreaSqft: range(q.minArea, q.maxArea) } : {}),
    ...(range(q.minYear, q.maxYear) ? { yearBuilt: range(q.minYear, q.maxYear) } : {}),
    ...(q.homestead ? { homestead: q.homestead === 'yes' } : {}),
    ...(q.over65 ? { taxCeiling: q.over65 === 'yes' } : {}),
    ...(q.minEquityPct !== undefined ? { equityIndex: { gte: 1 + q.minEquityPct / 100 } } : {}),
  };
}

const BROWSE_ORDER: Record<
  CalculatorBrowseQuery['sort'],
  (dir: 'asc' | 'desc') => Prisma.CadParcelOrderByWithRelationInput
> = {
  equity: (dir) => ({ equityIndex: dir }),
  market: (dir) => ({ marketValue: dir }),
  area: (dir) => ({ livingAreaSqft: { sort: dir, nulls: 'last' } }),
  year: (dir) => ({ yearBuilt: { sort: dir, nulls: 'last' } }),
  address: (dir) => ({ situsLine: { sort: dir, nulls: 'last' } }),
};

export const calculatorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/calculator/facets',
    {
      schema: {
        params: OrgParams,
        querystring: z.object({
          countyId: z.coerce.number().int().positive(),
          taxYear: z.coerce.number().int(),
        }),
        response: { 200: CalculatorFacets },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const { countyId, taxYear } = request.query;
      const load = await db.cadLoad.findUnique({
        where: { countyId_taxYear: { countyId, taxYear } },
        select: { loadedAt: true },
      });
      if (!load) return { propertyUses: [], grades: [] };
      const entry = rollCacheEntry(countyId, taxYear, load.loadedAt);
      if (entry.facets) return entry.facets;
      const [uses, grades] = await Promise.all([
        db.cadParcel.groupBy({
          by: ['propertyUse'],
          where: { countyId, taxYear, propertyUse: { not: null } },
          orderBy: { propertyUse: 'asc' },
        }),
        db.cadParcel.groupBy({
          by: ['qualityCode'],
          where: { countyId, taxYear, qualityCode: { not: null } },
          orderBy: { qualityCode: 'asc' },
        }),
      ]);
      const facets = {
        propertyUses: uses.map((u) => u.propertyUse!),
        grades: grades.map((g) => g.qualityCode!),
      };
      entry.facets = facets;
      return facets;
    },
  );

  app.get(
    '/calculator/parcels',
    {
      schema: {
        params: OrgParams,
        querystring: CalculatorBrowseQuery,
        response: { 200: CalculatorBrowseResult },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const q = request.query;
      const filters = browseWhere(q);
      // Sorting by the index lists only indexed properties: without enough comparables the
      // number means nothing, and it keeps the sort on the (county, year, index) index.
      const where: Prisma.CadParcelWhereInput =
        q.sort === 'equity'
          ? {
              ...filters,
              equityIndex: { not: null, ...(filters.equityIndex as Prisma.DecimalNullableFilter) },
            }
          : filters;
      // Counting a whole county is the slow part. With no filters the total is the load's
      // parcel count, or (sorted by the index) the indexed count, cached per load.
      const unfiltered = Object.keys(filters).length === 2;
      const total = async () => {
        if (!unfiltered) return db.cadParcel.count({ where });
        const load = await db.cadLoad.findUnique({
          where: { countyId_taxYear: { countyId: q.countyId, taxYear: q.taxYear } },
          select: { parcelCount: true, loadedAt: true },
        });
        if (!load) return 0;
        if (q.sort !== 'equity') return load.parcelCount;
        const entry = rollCacheEntry(q.countyId, q.taxYear, load.loadedAt);
        entry.indexedCount ??= await db.cadParcel.count({ where });
        return entry.indexedCount;
      };
      const [rows, count] = await Promise.all([
        db.cadParcel.findMany({
          where,
          select: {
            ...summarySelect,
            propertyUse: true,
            neighborhoodCode: true,
            livingAreaSqft: true,
            yearBuilt: true,
            qualityCode: true,
            improvementValue: true,
            equityIndex: true,
            homestead: true,
            taxCeiling: true,
          },
          orderBy: [BROWSE_ORDER[q.sort](q.dir), { accountNumber: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        total(),
      ]);
      return {
        items: rows.map(({ improvementValue, equityIndex, ...r }) => ({
          ...r,
          kind: propertyKindOf(r.stateClass),
          marketValue: money(r.marketValue)!,
          appraisedValue: money(r.appraisedValue)!,
          improvementPerSqft: r.livingAreaSqft
            ? (Number(improvementValue) / r.livingAreaSqft).toFixed(2)
            : null,
          equityPct:
            equityIndex === null ? null : Math.round((Number(equityIndex) - 1) * 1000) / 10,
        })),
        total: count,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.get(
    '/calculator/coverage',
    { schema: { params: OrgParams, response: { 200: CalculatorCoverage } } },
    async (request) => {
      const loads = await tenantOf(request).db.cadLoad.findMany({
        select: { taxYear: true, county: { select: { id: true, name: true } } },
        orderBy: [{ county: { name: 'asc' } }, { taxYear: 'desc' }],
      });
      const byCounty = new Map<number, CalculatorCoverage[number]>();
      for (const l of loads) {
        const entry = byCounty.get(l.county.id) ?? {
          countyId: l.county.id,
          countyName: l.county.name,
          taxYears: [],
        };
        entry.taxYears.push(l.taxYear);
        byCounty.set(l.county.id, entry);
      }
      return [...byCounty.values()];
    },
  );

  app.get(
    '/calculator/search',
    {
      schema: {
        params: OrgParams,
        querystring: CalculatorSearchQuery,
        response: { 200: z.array(CadParcelSummary) },
      },
    },
    async (request) => {
      const { countyId, taxYear, q } = request.query;
      const account = rollAccount(q);
      const { db } = tenantOf(request);
      // Something that looks like an account number is a prefix search on the unique index.
      // A range (not LIKE 'x%', which the default collation can't index) keeps it fast.
      // Addresses like "1700 ST CHARLES" fall through to the text search when nothing matches.
      let rows: Awaited<
        ReturnType<typeof db.cadParcel.findMany<{ select: typeof summarySelect }>>
      > = [];
      if (/^[0-9A-Z]{4,}$/.test(account) && /\d/.test(account)) {
        const next = prefixUpperBound(account);
        rows = await db.cadParcel.findMany({
          where: {
            countyId,
            taxYear,
            accountNumber: { gte: account, ...(next ? { lt: next } : {}) },
          },
          select: summarySelect,
          orderBy: { accountNumber: 'asc' },
          take: 20,
        });
      }
      if (rows.length === 0) {
        rows = await db.cadParcel.findMany({
          where: {
            countyId,
            taxYear,
            OR: [
              { situsLine: { contains: q, mode: 'insensitive' as const } },
              { ownerName: { contains: q, mode: 'insensitive' as const } },
            ],
          },
          select: summarySelect,
          orderBy: [{ situsLine: 'asc' }, { accountNumber: 'asc' }],
          take: 20,
        });
      }
      return rows.map((r) => ({
        ...r,
        marketValue: money(r.marketValue)!,
        appraisedValue: money(r.appraisedValue)!,
      }));
    },
  );

  app.get(
    '/calculator/estimate',
    {
      schema: {
        params: OrgParams,
        querystring: CalculatorEstimateQuery,
        response: { 200: CalculatorEstimate },
      },
    },
    async (request) => {
      const { db } = tenantOf(request);
      const { countyId, taxYear, account, contingencyPct } = request.query;
      const parcel = await findParcel(db, countyId, taxYear, account);

      const kind = propertyKindOf(parcel.stateClass);
      const widest = RULES[kind].wide.areaPct;
      const area = parcel.livingAreaSqft;
      // Homes compare within their neighborhood; commercial buildings with the same building
      // type across the CAD's market area (spec 5a), when the county records one.
      const scope =
        kind === 'COMMERCIAL' && parcel.marketArea
          ? { marketArea: parcel.marketArea, propertyUse: parcel.propertyUse }
          : kind === 'COMMERCIAL'
            ? { neighborhoodCode: parcel.neighborhoodCode, propertyUse: parcel.propertyUse }
            : { neighborhoodCode: parcel.neighborhoodCode };
      // Up to 2,500 candidates on each side of the subject's size, closest first, so a large
      // neighborhood or market area always yields the nearest comparables, deterministically.
      const candidateQuery = (side: 'above' | 'below') =>
        db.cadParcel.findMany({
          where: {
            countyId,
            taxYear,
            stateClass: parcel.stateClass,
            ...scope,
            livingAreaSqft:
              side === 'above'
                ? { gte: area!, lte: Math.ceil((area! * (100 + widest)) / 100) }
                : { gte: Math.floor((area! * (100 - widest)) / 100), lt: area! },
          },
          select: {
            accountNumber: true,
            situsLine: true,
            landValue: true,
            improvementValue: true,
            marketValue: true,
            appraisedValue: true,
            livingAreaSqft: true,
            yearBuilt: true,
            qualityCode: true,
            neighborhoodCode: true,
            propertyUse: true,
          },
          orderBy: [
            { livingAreaSqft: side === 'above' ? 'asc' : 'desc' },
            { accountNumber: 'asc' },
          ],
          take: 2500,
        });
      const candidates = area
        ? (await Promise.all([candidateQuery('above'), candidateQuery('below')])).flat()
        : [];

      const stored = parcel.units as unknown as StoredUnit[];
      const unitRows = stored.length
        ? await db.cadTaxUnit.findMany({
            where: { countyId, taxYear, code: { in: stored.map((u) => u.code) } },
          })
        : [];
      const unitByCode = new Map(unitRows.map((u) => [u.code, u]));
      const units: EstimateTaxUnit[] = stored.map((u) => {
        const meta = unitByCode.get(u.code);
        return {
          code: u.code,
          name: meta?.name ?? `Taxing unit ${u.code}`,
          kind: (meta?.kind ?? 'OTHER') as TaxUnitKind,
          ratePct: dec(meta?.ratePct),
          taxableValue: String(u.taxableValue),
          exemptPct: u.exemptPct === undefined ? undefined : String(u.exemptPct),
        };
      });

      // The firm's own property for this account, if any: its fee terms and tax rate apply.
      const firmProperty = await findFirmProperty(db, countyId, parcel.accountNumber);
      const propertyQuery = firmProperty
        ? db.property.findUnique({
            where: { id: firmProperty.id },
            select: {
              id: true,
              archivedAt: true,
              contingencyPct: true,
              flatFee: true,
              bppFee: true,
              contact: {
                select: {
                  id: true,
                  displayName: true,
                  contingencyPct: true,
                  flatFee: true,
                  bppFee: true,
                },
              },
              taxYears: {
                where: { taxYear },
                select: { contingencyPctOverride: true, taxRatePct: true },
              },
            },
          })
        : Promise.resolve(null);
      const [property, load, org] = await Promise.all([
        propertyQuery,
        db.cadLoad.findUnique({
          where: { countyId_taxYear: { countyId, taxYear } },
          select: { notes: true },
        }),
        db.org.findFirstOrThrow({
          select: { defaultContingencyPct: true, defaultFlatFee: true, defaultBppFee: true },
        }),
      ]);
      const year = property?.taxYears[0];
      const terms = resolveFeeTerms({
        taxYear: { contingencyPctOverride: dec(year?.contingencyPctOverride) },
        property: { contingencyPct: dec(property?.contingencyPct) },
        client: { contingencyPct: dec(property?.contact.contingencyPct) },
        firm: {
          defaultContingencyPct: org.defaultContingencyPct.toString(),
          defaultFlatFee: org.defaultFlatFee.toString(),
          defaultBppFee: org.defaultBppFee.toString(),
        },
      });

      const estimate = estimateSavings({
        kind,
        subject: {
          accountNumber: parcel.accountNumber,
          situsLine: parcel.situsLine,
          landValue: parcel.landValue.toString(),
          improvementValue: parcel.improvementValue.toString(),
          marketValue: parcel.marketValue.toString(),
          appraisedValue: parcel.appraisedValue.toString(),
          livingAreaSqft: parcel.livingAreaSqft,
          yearBuilt: parcel.yearBuilt,
          qualityCode: parcel.qualityCode,
          neighborhoodCode: parcel.neighborhoodCode,
          propertyUse: parcel.propertyUse,
          taxCeiling: parcel.taxCeiling,
        },
        candidates: candidates.map((c) => ({
          ...c,
          landValue: c.landValue.toString(),
          improvementValue: c.improvementValue.toString(),
          marketValue: c.marketValue.toString(),
          appraisedValue: c.appraisedValue.toString(),
        })),
        units,
        fallbackTaxRatePct: dec(year?.taxRatePct),
        contingencyPct: contingencyPct ?? terms.contingencyPct.value,
      });

      return {
        county: parcel.county,
        taxYear,
        parcel: {
          accountNumber: parcel.accountNumber,
          ownerName: parcel.ownerName,
          situsLine: parcel.situsLine,
          situsZip: parcel.situsZip,
          stateClass: parcel.stateClass,
          kind,
          neighborhoodCode: parcel.neighborhoodCode,
          marketArea: parcel.marketArea,
          propertyUse: parcel.propertyUse,
          landValue: money(parcel.landValue)!,
          improvementValue: money(parcel.improvementValue)!,
          marketValue: money(parcel.marketValue)!,
          appraisedValue: money(parcel.appraisedValue)!,
          livingAreaSqft: parcel.livingAreaSqft,
          yearBuilt: parcel.yearBuilt,
          qualityCode: parcel.qualityCode,
          homestead: parcel.homestead,
          taxCeiling: parcel.taxCeiling,
        },
        estimate: { ...estimate, warnings: [...estimate.warnings, ...(load?.notes ?? [])] },
        contingencySource: contingencyPct ? ('WHAT_IF' as const) : terms.contingencyPct.source,
        property: property
          ? {
              id: property.id,
              contactId: property.contact.id,
              contactName: property.contact.displayName,
              archived: property.archivedAt !== null,
            }
          : null,
      };
    },
  );

  app.post(
    '/calculator/prospect',
    {
      preValidation: requireRole('STAFF'),
      schema: {
        params: OrgParams,
        body: CreateProspectFromParcelInput,
        response: { 201: CreatedFromParcel },
      },
    },
    async (request, reply) => {
      const { db, orgId, userId } = tenantOf(request);
      const { countyId, taxYear, account, displayName, email, phone } = request.body;
      const parcel = await findParcel(db, countyId, taxYear, account);
      const duplicate = () =>
        conflict('This account is already in your firm. Open its property page instead.');
      if (await findFirmProperty(db, countyId, parcel.accountNumber)) throw duplicate();

      // Each forOrg query is its own transaction, so a failure part-way is undone by hand:
      // whatever was created is deleted again, and a concurrent duplicate becomes a 409.
      const contact = await db.contact.create({
        data: {
          orgId,
          kind: 'PROSPECT',
          status: 'NEW',
          source: 'MANUAL',
          displayName,
          email,
          phone,
          nameOnCad: parcel.ownerName,
        },
      });
      const situsAddress = parcel.situsLine
        ? { line1: parcel.situsLine, city: '', state: 'TX', zip: parcel.situsZip ?? '' }
        : undefined;
      let propertyId: number | null = null;
      try {
        const property = await db.property.create({
          data: {
            orgId,
            contactId: contact.id,
            countyId,
            accountNumber: parcel.accountNumber,
            propertyType:
              propertyKindOf(parcel.stateClass) === 'COMMERCIAL' ? 'COMMERCIAL' : 'RESIDENTIAL',
            situsAddress,
            situsLine: parcel.situsLine,
          },
        });
        propertyId = property.id;
        const record = await db.taxYearRecord.create({
          data: {
            orgId,
            propertyId: property.id,
            taxYear,
            noticeLand: parcel.landValue,
            noticeImprovement: parcel.improvementValue,
            noticeMarket: parcel.marketValue,
            noticeAppraised: parcel.appraisedValue,
            homestead: parcel.homestead,
          },
        });
        await db.protestStageEvent.create({
          data: {
            orgId,
            taxYearRecordId: record.id,
            fromStage: null,
            toStage: 'NOT_STARTED',
            note: 'Created from the savings calculator',
            actorUserId: userId,
          },
        });
      } catch (e) {
        // Tax-year records and stage events go with the property (cascade).
        if (propertyId !== null) await db.property.delete({ where: { id: propertyId } });
        await db.contact.delete({ where: { id: contact.id } });
        if (isUniqueViolation(e)) throw duplicate();
        throw e;
      }
      await recordAudit(db, orgId, actorOf(request), {
        action: 'contact.created',
        entityType: 'Contact',
        entityId: contact.id,
        after: { kind: 'PROSPECT', displayName, source: 'calculator' },
      });
      await recordAudit(db, orgId, actorOf(request), {
        action: 'property.created',
        entityType: 'Property',
        entityId: propertyId,
        after: { accountNumber: parcel.accountNumber, countyId, contactId: contact.id },
      });
      return reply.code(201).send({ contactId: contact.id, propertyId });
    },
  );
};
