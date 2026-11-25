import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';

// Writes one county-year of a CAD roll (spec savings-calculator.md section 4). The whole
// county-year is replaced in one transaction, so readers never see a half-loaded roll and
// re-running a load changes nothing.

export interface ParcelRow {
  accountNumber: string;
  stateClass: string;
  neighborhoodCode: string;
  ownerName: string | null;
  situsLine: string | null;
  situsZip: string | null;
  landValue: string;
  improvementValue: string;
  marketValue: string;
  appraisedValue: string;
  livingAreaSqft: number | null;
  yearBuilt: number | null;
  qualityCode: string | null;
  propertyUse?: string | null;
  marketArea?: string | null;
  homestead: boolean;
  taxCeiling: boolean;
  units: { code: string; taxableValue: string; exemptPct: string }[];
}

export interface TaxUnitRow {
  code: string;
  name: string;
  kind: 'SCHOOL' | 'COUNTY' | 'CITY' | 'OTHER';
  ratePct: string | null;
}

export interface RollLoad {
  countyName: string;
  taxYear: number;
  source: string;
  files: Record<string, unknown>;
  /** Known gaps in the county's data, shown as warnings on its estimates. */
  notes?: string[];
  units: TaxUnitRow[];
  parcels: AsyncIterable<ParcelRow> | Iterable<ParcelRow>;
}

const CHUNK = 5000;

export async function countyIdFor(prisma: PrismaClient, name: string): Promise<number> {
  const county = await prisma.county.findUnique({
    where: { state_name: { state: 'TX', name } },
    select: { id: true },
  });
  if (!county)
    throw new Error(`County ${name} is missing. Run \`pnpm db:backfill counties\` first.`);
  return county.id;
}

/**
 * Sets CadParcel.equityIndex for a county-year: each property's improvement value per sq ft ÷
 * the median of its group, the comparable set the estimate also uses (spec 5 and 5a): homes by
 * neighborhood and class; commercial by market area (or neighborhood) and building type.
 * Groups of fewer than 5, buildings under 300 sq ft, and ratios outside 0.1–10× (data errors)
 * get no index. Powers the calculator's "over-assessed" filter.
 */
export async function computeEquityIndex(
  db: Pick<PrismaClient, '$executeRaw'>,
  countyId: number,
  taxYear: number,
): Promise<number> {
  // Clear first, so a property that no longer qualifies doesn't keep an old index.
  await db.$executeRaw`
    UPDATE "CadParcel" SET "equityIndex" = NULL
    WHERE "countyId" = ${countyId} AND "taxYear" = ${taxYear} AND "equityIndex" IS NOT NULL`;
  return db.$executeRaw`
    WITH g AS (
      SELECT id,
             "improvementValue" / "livingAreaSqft" AS psf,
             CASE WHEN "stateClass" LIKE 'F%' THEN COALESCE("marketArea", "neighborhoodCode")
                  ELSE "neighborhoodCode" END AS grp,
             "stateClass" AS cls,
             COALESCE("propertyUse", '') AS use
      FROM "CadParcel"
      WHERE "countyId" = ${countyId} AND "taxYear" = ${taxYear}
        AND "livingAreaSqft" >= 300 AND "improvementValue" > 0
    ), m AS (
      SELECT grp, cls, use,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY psf) AS med,
             count(*) AS n
      FROM g GROUP BY grp, cls, use
    )
    UPDATE "CadParcel" p
    SET "equityIndex" = round((g.psf / m.med)::numeric, 4)
    FROM g JOIN m USING (grp, cls, use)
    WHERE p.id = g.id AND m.n >= 5 AND m.med > 0
      -- More than 10× or under a tenth of the neighborhood is a data error (a 4 sq ft "house").
      AND g.psf / m.med BETWEEN 0.1 AND 10`;
}

export async function replaceCountyYear(prisma: PrismaClient, load: RollLoad): Promise<number> {
  const countyId = await countyIdFor(prisma, load.countyName);
  const { taxYear } = load;
  const started = Date.now();
  let count = 0;
  await prisma.$transaction(
    async (tx) => {
      await tx.cadParcel.deleteMany({ where: { countyId, taxYear } });
      await tx.cadTaxUnit.deleteMany({ where: { countyId, taxYear } });
      await tx.cadTaxUnit.createMany({
        data: load.units.map((u) => ({ ...u, countyId, taxYear })),
      });
      let batch: ParcelRow[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        await tx.cadParcel.createMany({
          data: batch.map((p) => ({ ...p, countyId, taxYear })),
        });
        count += batch.length;
        batch = [];
        if (count >= 100_000 && count % 100_000 < CHUNK)
          log(`cad: ${load.countyName} ${taxYear}: ${count} parcels…`);
      };
      for await (const p of load.parcels) {
        batch.push(p);
        if (batch.length >= CHUNK) await flush();
      }
      await flush();
      log(`cad: ${load.countyName} ${taxYear}: computing equity index…`);
      await computeEquityIndex(tx, countyId, taxYear);
      await tx.cadLoad.upsert({
        where: { countyId_taxYear: { countyId, taxYear } },
        create: {
          countyId,
          taxYear,
          source: load.source,
          files: load.files as object,
          notes: load.notes ?? [],
          parcelCount: count,
        },
        update: {
          source: load.source,
          files: load.files as object,
          notes: load.notes ?? [],
          parcelCount: count,
          loadedAt: new Date(),
        },
      });
    },
    { timeout: 60 * 60 * 1000, maxWait: 60_000 },
  );
  log(
    `cad: ${load.countyName} ${taxYear}: ${count} parcels and ${load.units.length} taxing units loaded in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  return count;
}
