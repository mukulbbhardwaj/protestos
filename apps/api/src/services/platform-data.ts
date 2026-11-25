import type { PlatformCountyDetail, PlatformDataOverview } from '@app/shared';
import type { ServiceContext } from './context.js';

// What data is in the system, for the platform admin page (super-admins only). The CAD roll
// aggregates scan millions of rows, so results are cached until a county-year is reloaded.

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

const MARKET_BUCKETS: [label: string, upTo: number][] = [
  ['Under $100k', 100_000],
  ['$100k–200k', 200_000],
  ['$200k–300k', 300_000],
  ['$300k–500k', 500_000],
  ['$500k–750k', 750_000],
  ['$750k–1M', 1_000_000],
  ['$1M–2M', 2_000_000],
  ['$2M–5M', 5_000_000],
  ['$5M+', Number.POSITIVE_INFINITY],
];

/** Equity index → percent above neighbors, bucketed. */
const EQUITY_BUCKETS: [label: string, upTo: number][] = [
  ['30%+ below', 0.7],
  ['15–30% below', 0.85],
  ['5–15% below', 0.95],
  ['Within 5%', 1.05],
  ['5–15% above', 1.15],
  ['15–30% above', 1.3],
  // Three steps each side of the middle (dataviz: equal arms on a diverging scale).
  ['30%+ above', Number.POSITIVE_INFINITY],
];

interface LoadRow {
  countyId: number;
  countyName: string;
  taxYear: number;
  source: string;
  loadedAt: Date;
  notes: string[];
}

export function createPlatformDataService({ prisma }: ServiceContext) {
  let overviewCache: { key: string; value: PlatformDataOverview } | null = null;
  const detailCache = new Map<string, PlatformCountyDetail>();

  async function loads(): Promise<LoadRow[]> {
    const rows = await prisma.cadLoad.findMany({
      select: {
        countyId: true,
        taxYear: true,
        source: true,
        loadedAt: true,
        notes: true,
        county: { select: { name: true } },
      },
      orderBy: [{ county: { name: 'asc' } }, { taxYear: 'desc' }],
    });
    return rows.map((r) => ({ ...r, countyName: r.county.name }));
  }

  const loadKey = (l: LoadRow[]) =>
    l.map((r) => `${r.countyId}:${r.taxYear}:${r.loadedAt.toISOString()}`).join('|');

  return {
    async overview(): Promise<PlatformDataOverview> {
      const current = await loads();
      const key = loadKey(current);
      // Tenant totals are cheap and change often; the roll aggregates are cached per load.
      const [firms, users, clients, prospects, properties, taxYearRecords] = await Promise.all([
        prisma.org.count(),
        prisma.user.count(),
        prisma.contact.count({ where: { kind: 'CLIENT', archivedAt: null } }),
        prisma.contact.count({ where: { kind: 'PROSPECT', archivedAt: null } }),
        prisma.property.count({ where: { archivedAt: null } }),
        prisma.taxYearRecord.count(),
      ]);
      if (overviewCache?.key !== key) {
        const stats = await prisma.$queryRaw<
          {
            countyId: number;
            taxYear: number;
            parcels: bigint;
            commercial: bigint;
            total_market: string;
            median_market: string | null;
            no_area: bigint;
            no_year: bigint;
            no_grade: bigint;
            no_owner: bigint;
            no_address: bigint;
            homestead: bigint;
            ceiling: bigint;
            indexed: bigint;
          }[]
        >`
          SELECT "countyId", "taxYear",
                 count(*) AS parcels,
                 count(*) FILTER (WHERE "stateClass" LIKE 'F%') AS commercial,
                 sum("marketValue")::text AS total_market,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY "marketValue"))::text AS median_market,
                 count(*) FILTER (WHERE "livingAreaSqft" IS NULL) AS no_area,
                 count(*) FILTER (WHERE "yearBuilt" IS NULL) AS no_year,
                 count(*) FILTER (WHERE "qualityCode" IS NULL) AS no_grade,
                 count(*) FILTER (WHERE "ownerName" IS NULL) AS no_owner,
                 count(*) FILTER (WHERE "situsLine" IS NULL) AS no_address,
                 count(*) FILTER (WHERE homestead) AS homestead,
                 count(*) FILTER (WHERE "taxCeiling") AS ceiling,
                 count("equityIndex") AS indexed
          FROM "CadParcel" GROUP BY "countyId", "taxYear"`;
        const units = await prisma.$queryRaw<
          { countyId: number; taxYear: number; units: bigint; rated: bigint }[]
        >`
          SELECT "countyId", "taxYear", count(*) AS units, count("ratePct") AS rated
          FROM "CadTaxUnit" GROUP BY "countyId", "taxYear"`;
        const byKey = <T extends { countyId: number; taxYear: number }>(rows: T[]) =>
          new Map(rows.map((r) => [`${r.countyId}:${r.taxYear}`, r]));
        const s = byKey(stats);
        const u = byKey(units);
        overviewCache = {
          key,
          value: {
            totals: { firms, users, clients, prospects, properties, taxYearRecords, cadParcels: 0 },
            computedAt: new Date().toISOString(),
            loads: current.map((l) => {
              const r = s.get(`${l.countyId}:${l.taxYear}`);
              const n = Number(r?.parcels ?? 0);
              const commercial = Number(r?.commercial ?? 0);
              const t = u.get(`${l.countyId}:${l.taxYear}`);
              return {
                countyId: l.countyId,
                countyName: l.countyName,
                taxYear: l.taxYear,
                source: l.source,
                loadedAt: l.loadedAt.toISOString(),
                notes: l.notes,
                parcels: n,
                homes: n - commercial,
                commercial,
                totalMarketValue: Number(r?.total_market ?? 0).toFixed(2),
                medianMarketValue: r?.median_market ? Number(r.median_market).toFixed(2) : null,
                missing: {
                  area: pct(Number(r?.no_area ?? 0), n),
                  yearBuilt: pct(Number(r?.no_year ?? 0), n),
                  grade: pct(Number(r?.no_grade ?? 0), n),
                  owner: pct(Number(r?.no_owner ?? 0), n),
                  address: pct(Number(r?.no_address ?? 0), n),
                },
                homesteadPct: pct(Number(r?.homestead ?? 0), n),
                taxCeilingPct: pct(Number(r?.ceiling ?? 0), n),
                equityIndexedPct: pct(Number(r?.indexed ?? 0), n),
                taxUnits: Number(t?.units ?? 0),
                taxUnitsWithRate: Number(t?.rated ?? 0),
              };
            }),
          },
        };
      }
      const value = overviewCache.value;
      return {
        ...value,
        totals: {
          firms,
          users,
          clients,
          prospects,
          properties,
          taxYearRecords,
          cadParcels: value.loads.reduce((sum, l) => sum + l.parcels, 0),
        },
      };
    },

    async county(countyId: number, taxYear: number): Promise<PlatformCountyDetail | null> {
      const load = (await loads()).find((l) => l.countyId === countyId && l.taxYear === taxYear);
      if (!load) return null;
      const key = `${countyId}:${taxYear}:${load.loadedAt.toISOString()}`;
      const cached = detailCache.get(key);
      if (cached) return cached;

      const where = { countyId, taxYear };
      const [classes, uses, market, equity, units, unitUse] = await Promise.all([
        prisma.cadParcel.groupBy({
          by: ['stateClass'],
          where,
          _count: { _all: true },
          orderBy: { _count: { stateClass: 'desc' } },
        }),
        prisma.cadParcel.groupBy({
          by: ['propertyUse'],
          where: { ...where, propertyUse: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { propertyUse: 'desc' } },
          take: 15,
        }),
        prisma.$queryRaw<{ bucket: number; count: bigint }[]>`
          SELECT width_bucket("marketValue"::float8,
                   ${MARKET_BUCKETS.slice(0, -1).map(([, v]) => v)}::float8[]) AS bucket,
                 count(*) AS count
          FROM "CadParcel" WHERE "countyId" = ${countyId} AND "taxYear" = ${taxYear}
          GROUP BY 1`,
        prisma.$queryRaw<{ bucket: number | null; count: bigint }[]>`
          SELECT CASE WHEN "equityIndex" IS NULL THEN NULL
                      ELSE width_bucket("equityIndex"::float8,
                             ${EQUITY_BUCKETS.slice(0, -1).map(([, v]) => v)}::float8[]) END AS bucket,
                 count(*) AS count
          FROM "CadParcel" WHERE "countyId" = ${countyId} AND "taxYear" = ${taxYear}
          GROUP BY 1`,
        prisma.cadTaxUnit.findMany({ where, orderBy: { code: 'asc' } }),
        prisma.$queryRaw<{ code: string; parcels: bigint }[]>`
          SELECT u->>'code' AS code, count(*) AS parcels
          FROM "CadParcel" p, jsonb_array_elements(p.units) u
          WHERE p."countyId" = ${countyId} AND p."taxYear" = ${taxYear}
          GROUP BY 1`,
      ]);

      const counts = new Map(unitUse.map((r) => [r.code, Number(r.parcels)]));
      const rated = new Set(units.filter((u) => u.ratePct !== null).map((u) => u.code));
      let pairs = 0;
      let ratedPairs = 0;
      for (const [code, n] of counts) {
        pairs += n;
        if (rated.has(code)) ratedPairs += n;
      }
      const bucketCounts = (rows: { bucket: number | null; count: bigint }[], i: number) =>
        Number(rows.find((r) => r.bucket === i)?.count ?? 0);

      const detail: PlatformCountyDetail = {
        countyId,
        countyName: load.countyName,
        taxYear,
        classes: classes.map((c) => ({ stateClass: c.stateClass, count: c._count._all })),
        marketValue: MARKET_BUCKETS.map(([label], i) => ({
          label,
          count: bucketCounts(market, i),
        })),
        equity: [
          ...EQUITY_BUCKETS.map(([label], i) => ({ label, count: bucketCounts(equity, i) })),
          {
            label: 'Not indexed',
            count: Number(equity.find((r) => r.bucket === null)?.count ?? 0),
          },
        ],
        buildingTypes: uses.map((u) => ({ propertyUse: u.propertyUse!, count: u._count._all })),
        rateCoveragePct: pct(ratedPairs, pairs),
        units: units
          .map((u) => ({
            code: u.code,
            name: u.name,
            kind: u.kind,
            ratePct: u.ratePct?.toString() ?? null,
            parcels: counts.get(u.code) ?? 0,
          }))
          .sort((a, b) => b.parcels - a.parcels),
        computedAt: new Date().toISOString(),
      };
      detailCache.set(key, detail);
      return detail;
    },
  };
}
