import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { readFixed } from './fixed.js';
import { replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';

// "Legacy 8.0.x appraisal export": the fixed-width format published by CADs that run the
// True Automation / True Prodigy appraisal system (Travis, Denton, and many others).
// Positions are from the 8.0.32 and 8.0.33 layouts, which agree on every field used here.
// One adapter, configured per county (spec savings-calculator.md section 4, ADR 006).

const PROPERTY = {
  prop_id: [1, 12],
  prop_type_cd: [13, 17],
  geo_id: [547, 596],
  py_owner_name: [609, 678],
  situs_street_prefx: [1040, 1049],
  situs_street: [1050, 1099],
  situs_street_suffix: [1100, 1109],
  situs_zip: [1140, 1149],
  hood_cd: [1686, 1695],
  land_hstd_val: [1796, 1810],
  land_non_hstd_val: [1811, 1825],
  imprv_hstd_val: [1826, 1840],
  imprv_non_hstd_val: [1841, 1855],
  ag_market: [1871, 1885],
  timber_market: [1901, 1915],
  assessed_val: [1946, 1960],
  hs_exempt: [2609, 2609],
  ov65_exempt: [2610, 2610],
  ov65s_exempt: [2661, 2661],
  dp_exempt: [2662, 2662],
  imprv_state_cd: [2732, 2741],
  land_state_cd: [2742, 2751],
  market_value: [4214, 4227],
  situs_num: [4460, 4474],
} as const;

const PROPERTY_ENTITY = {
  prop_id: [1, 12],
  entity_cd: [54, 63],
  entity_name: [64, 113],
  assessed_val: [149, 163],
  taxable_val: [164, 178],
  hs_local_amt: [479, 493],
} as const;

const IMPROVEMENT_DETAIL = {
  prop_id: [1, 12],
  imprv_id: [17, 28],
  type_cd: [41, 50],
  type_desc: [51, 75],
  class_cd: [76, 85],
  yr_built: [86, 89],
  area: [94, 108],
} as const;

export interface PacsCounty {
  countyName: string;
  /** Default download folder name under .data/. */
  slug: string;
  /** Detail rows that are heated living area (the rest are garages, porches, decks …). */
  livingArea: (typeCd: string, typeDesc: string) => boolean;
  /**
   * Detail rows that are commercial buildings with a real building type (office, retail …).
   * Counties that set this also load commercial property (F1, spec 5a); counties whose detail
   * rows don't name a building type leave it out, since comparables must match type.
   */
  commercialBuilding?: (typeCd: string, typeDesc: string) => boolean;
  /** Where the export came from, for CadLoad provenance. */
  source: string;
}

export interface RateFile {
  source: string;
  /** entity_cd → rate in percent (per $100), e.g. "0.8683". */
  rates: Record<string, string>;
  /** entity_cd → unit name, for exports that carry only codes. */
  names?: Record<string, string>;
}

/** The appraisal district itself appears as an entity but levies no tax. */
const NOT_TAXING = new Set(['CAD']);
const n = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : 0);
const yes = (v: string) => v === 'T' || v === 'Y';

function unitKind(name: string): TaxUnitRow['kind'] {
  const upper = name.toUpperCase();
  if (/\bI\.?S\.?D\b|INDEPENDENT SCHOOL/.test(upper)) return 'SCHOOL';
  if (/^CITY OF\b|\bCITY$/.test(upper)) return 'CITY';
  if (
    /\bCOUNTY\b/.test(upper) &&
    !/\b(ESD|EMERGENCY|HOSP|HEALTHCARE|MUD|WCID|DISTRICT)\b/.test(upper)
  ) {
    return 'COUNTY';
  }
  return 'OTHER';
}

/** Export files are named like 2026-07-18_000123_APPRAISAL_INFO.TXT; find by suffix. */
function exportFile(dir: string, suffix: string): string {
  const found = readdirSync(dir, { recursive: true, encoding: 'utf8' }).find((f) =>
    f.toUpperCase().endsWith(suffix),
  );
  if (!found) throw new Error(`No *${suffix} in ${dir}. Unzip the county's export there first.`);
  return join(dir, found);
}

/** State code like "A1" or "A1 " or "A1R" → the class we load it as, or null. */
const stateClassOf = (classes: string[], imprv: string, land: string) => {
  const code = (imprv || land).toUpperCase();
  return classes.find((c) => code.startsWith(c)) ?? null;
};

export async function loadPacs(
  prisma: PrismaClient,
  county: PacsCounty,
  opts: { year: number; dir: string; ratesFile?: string },
) {
  const { year, dir } = opts;
  const rates: RateFile | null =
    opts.ratesFile && existsSync(opts.ratesFile)
      ? (JSON.parse(readFileSync(opts.ratesFile, 'utf8')) as RateFile)
      : null;
  if (!rates) log(`cad: no tax-rate file for ${county.countyName} ${year}; savings need rates`);
  const infoPath = exportFile(dir, 'APPRAISAL_INFO.TXT');
  const classes = county.commercialBuilding ? ['A1', 'F1'] : ['A1'];

  log(`cad: ${county.countyName}: finding properties…`);
  const wanted = new Set<number>();
  const commercial = new Set<number>();
  for await (const r of readFixed(infoPath, {
    prop_id: PROPERTY.prop_id,
    prop_type_cd: PROPERTY.prop_type_cd,
    imprv_state_cd: PROPERTY.imprv_state_cd,
    land_state_cd: PROPERTY.land_state_cd,
  })) {
    const cls = r.prop_type_cd === 'R' && stateClassOf(classes, r.imprv_state_cd, r.land_state_cd);
    if (!cls) continue;
    wanted.add(n(r.prop_id));
    if (cls === 'F1') commercial.add(n(r.prop_id));
  }
  log(`cad: ${wanted.size} properties in classes ${classes.join(', ')} (${commercial.size} F1)`);

  log('cad: reading improvement details…');
  // prop → [area, year built, class, largest row, building type]; the largest row's year,
  // class and type win. Area is living area for homes, building area for commercial.
  const buildings = new Map<
    number,
    [area: number, year: number, cls: number, best: number, use: number]
  >();
  const labels: string[] = [];
  const labelIdx = new Map<string, number>();
  const label = (v: string) => {
    let i = labelIdx.get(v);
    if (i === undefined) {
      i = labels.push(v) - 1;
      labelIdx.set(v, i);
    }
    return i;
  };
  for await (const r of readFixed(
    exportFile(dir, 'APPRAISAL_IMPROVEMENT_DETAIL.TXT'),
    IMPROVEMENT_DETAIL,
  )) {
    const id = n(r.prop_id);
    if (!wanted.has(id)) continue;
    const isCommercial = commercial.has(id);
    const counts = isCommercial
      ? county.commercialBuilding!(r.type_cd, r.type_desc)
      : county.livingArea(r.type_cd, r.type_desc);
    if (!counts) continue;
    const area = n(r.area);
    const b = buildings.get(id) ?? [0, 0, -1, 0, -1];
    b[0] += area;
    if (area > b[3]) {
      // The largest row is the main structure: take its year, class and building type.
      b[3] = area;
      b[1] = n(r.yr_built);
      b[2] = r.class_cd ? label(r.class_cd) : -1;
      b[4] = isCommercial && r.type_desc ? label(r.type_desc) : -1;
    }
    buildings.set(id, b);
  }

  log('cad: reading taxing units…');
  const units = new Map<string, TaxUnitRow>();
  // prop → [unit index, taxable, local homestead % × 10,000] repeated.
  const unitCodes: string[] = [];
  const unitIdx = new Map<string, number>();
  const perProp = new Map<number, number[]>();
  for await (const r of readFixed(exportFile(dir, 'APPRAISAL_ENTITY_INFO.TXT'), PROPERTY_ENTITY)) {
    const id = n(r.prop_id);
    if (!wanted.has(id) || !r.entity_cd || NOT_TAXING.has(r.entity_cd)) continue;
    let u = unitIdx.get(r.entity_cd);
    if (u === undefined) {
      u = unitCodes.push(r.entity_cd) - 1;
      unitIdx.set(r.entity_cd, u);
      const rate = rates?.rates[r.entity_cd];
      units.set(r.entity_cd, {
        code: r.entity_cd,
        name: r.entity_name || r.entity_cd,
        kind: unitKind(r.entity_name),
        ratePct: rate && Number(rate) > 0 ? rate : null,
      });
    }
    // Local-option homestead exemptions are a percentage of value: the share applied here
    // is what a lower value saves at the margin (state and over-65 amounts are fixed).
    const assessed = n(r.assessed_val);
    const pct = assessed > 0 ? Math.min(100, (n(r.hs_local_amt) / assessed) * 100) : 0;
    let list = perProp.get(id);
    if (!list) perProp.set(id, (list = []));
    list.push(u, n(r.taxable_val), Math.round(pct * 10_000));
  }

  const seen = new Set<number>();
  async function* parcels(): AsyncGenerator<ParcelRow> {
    for await (const r of readFixed(infoPath, PROPERTY)) {
      const id = n(r.prop_id);
      // One row per owner: partial owners repeat the property. Keep the first.
      if (!wanted.has(id) || seen.has(id) || r.prop_type_cd !== 'R') continue;
      seen.add(id);
      const land =
        n(r.land_hstd_val) + n(r.land_non_hstd_val) + n(r.ag_market) + n(r.timber_market);
      const improvement = n(r.imprv_hstd_val) + n(r.imprv_non_hstd_val);
      const market = n(r.market_value) || land + improvement;
      const b = buildings.get(id);
      const u = perProp.get(id) ?? [];
      const parcelUnits: ParcelRow['units'] = [];
      for (let i = 0; i < u.length; i += 3) {
        parcelUnits.push({
          code: unitCodes[u[i]!]!,
          taxableValue: String(u[i + 1]),
          exemptPct: String(u[i + 2]! / 10_000),
        });
      }
      const situs = [r.situs_num, r.situs_street_prefx, r.situs_street, r.situs_street_suffix]
        .filter(Boolean)
        .join(' ');
      yield {
        accountNumber: r.prop_id.replace(/^0+/, ''),
        stateClass: commercial.has(id) ? 'F1' : 'A1',
        neighborhoodCode: r.hood_cd || 'UNKNOWN',
        ownerName: r.py_owner_name || null,
        situsLine: situs || null,
        situsZip: r.situs_zip || null,
        landValue: String(land),
        improvementValue: String(Math.max(0, market - land)),
        marketValue: String(market),
        appraisedValue: String(n(r.assessed_val) || market),
        livingAreaSqft: b && b[0] > 0 ? Math.round(b[0]) : null,
        yearBuilt: b && b[1] > 1800 ? b[1] : null,
        qualityCode: b && b[2] >= 0 ? labels[b[2]]! : null,
        propertyUse: b && b[4] >= 0 ? labels[b[4]]! : null,
        // No market area in this export: the ZIP code is the wider area for commercial comps.
        marketArea: r.situs_zip ? `ZIP ${r.situs_zip.slice(0, 5)}` : null,
        homestead: yes(r.hs_exempt),
        taxCeiling: yes(r.ov65_exempt) || yes(r.ov65s_exempt) || yes(r.dp_exempt),
        units: parcelUnits,
      };
    }
  }

  return replaceCountyYear(prisma, {
    countyName: county.countyName,
    taxYear: year,
    source: county.source + (rates ? `; rates: ${rates.source}` : '; no tax rates'),
    files: { dir, layout: 'Legacy 8.0.x appraisal export' },
    units: [...units.values()],
    parcels: parcels(),
  });
}
