import { z } from 'zod';

// Platform admin (super-admin only): what data is in the system. BUILD_PLAN 8.13.

const Pct = z.number().nullable();

export const PlatformTotals = z.object({
  firms: z.number(),
  users: z.number(),
  clients: z.number(),
  prospects: z.number(),
  properties: z.number(),
  taxYearRecords: z.number(),
  cadParcels: z.number(),
});

export const CadLoadSummary = z.object({
  countyId: z.number(),
  countyName: z.string(),
  taxYear: z.number(),
  source: z.string(),
  loadedAt: z.string(),
  notes: z.array(z.string()),
  parcels: z.number(),
  homes: z.number(),
  commercial: z.number(),
  totalMarketValue: z.string(),
  medianMarketValue: z.string().nullable(),
  /** Percent of parcels missing each field. */
  missing: z.object({
    area: Pct,
    yearBuilt: Pct,
    grade: Pct,
    owner: Pct,
    address: Pct,
  }),
  homesteadPct: Pct,
  taxCeilingPct: Pct,
  equityIndexedPct: Pct,
  taxUnits: z.number(),
  taxUnitsWithRate: z.number(),
});
export type CadLoadSummary = z.infer<typeof CadLoadSummary>;

export const PlatformDataOverview = z.object({
  totals: PlatformTotals,
  loads: z.array(CadLoadSummary),
  computedAt: z.string(),
});
export type PlatformDataOverview = z.infer<typeof PlatformDataOverview>;

const Bucket = z.object({ label: z.string(), count: z.number() });

export const PlatformCountyDetail = z.object({
  countyId: z.number(),
  countyName: z.string(),
  taxYear: z.number(),
  classes: z.array(z.object({ stateClass: z.string(), count: z.number() })),
  marketValue: z.array(Bucket),
  equity: z.array(Bucket),
  buildingTypes: z.array(z.object({ propertyUse: z.string(), count: z.number() })),
  /** Share of (home × taxing unit) pairs whose unit has a rate. */
  rateCoveragePct: Pct,
  units: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.string(),
      ratePct: z.string().nullable(),
      parcels: z.number(),
    }),
  ),
  computedAt: z.string(),
});
export type PlatformCountyDetail = z.infer<typeof PlatformCountyDetail>;
