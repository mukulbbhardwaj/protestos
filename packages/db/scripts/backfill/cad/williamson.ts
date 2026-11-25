import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { money as n, readCsv } from './csv.js';
import type { RateFile } from './pacs.js';
import { replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';

// Williamson Central Appraisal District open data (Socrata, https://data.wcad.org), linked from
// https://www.wcad.org/data-downloads/ (spec savings-calculator.md section 4, ADR 006).
//   property.csv         values, neighborhood, living area, situs (one row per property)
//   characteristics.csv  state code, class, year built
//   asmt.csv             per taxing unit: assessed and taxable value
//   exemptions.csv       exemption types (the portal keeps only the current year's list)
// No owner names (separate dataset) and no tax rates in the export.

const DATASETS = {
  'property.csv': 'ai3c-c9pf',
  'characteristics.csv': 'cvyp-ab5t',
  'asmt.csv': 'yeqp-u7bx',
  'exemptions.csv': 'nbn7-h4pp',
} as const;
const exportUrl = (id: string) => `https://data.wcad.org/api/v3/views/${id}/export.csv`;
const STATE_CLASSES = new Set(['A1']);
/** Over-65 (the §11.13(c) school exemption) and disabled persons carry the school ceiling. */
const CEILING = /11\.13\(c\)|Disabled Person/i;
/** "CAD" is the appraisal district itself, not a taxing unit. */
const NOT_TAXING = new Set(['CAD']);

function kindOf(code: string): TaxUnitRow['kind'] {
  // WCAD codes: S = school, C = city, G = county; everything else (MUDs, ESDs, …) is OTHER.
  if (code.startsWith('S')) return 'SCHOOL';
  if (code.startsWith('C')) return 'CITY';
  if (code.startsWith('G')) return 'COUNTY';
  return 'OTHER';
}

function download(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [file, id] of Object.entries(DATASETS)) {
    log(`cad: downloading Williamson ${file}…`);
    execFileSync('curl', ['-fsSL', '--retry', '5', '-o', join(dir, file), exportUrl(id)], {
      stdio: 'inherit',
    });
  }
}

export async function loadWilliamson(
  prisma: PrismaClient,
  opts: { year: number; dir: string; ratesFile?: string },
) {
  const { year, dir } = opts;
  if (Object.keys(DATASETS).some((f) => !existsSync(join(dir, f)))) download(dir);
  const rates: RateFile | null =
    opts.ratesFile && existsSync(opts.ratesFile)
      ? (JSON.parse(readFileSync(opts.ratesFile, 'utf8')) as RateFile)
      : null;
  if (!rates) log(`cad: no tax-rate file for Williamson ${year}; savings need rates`);

  log('cad: Williamson: reading characteristics…');
  const chars = new Map<string, { cls: string | null; year: number | null }>();
  for await (const r of readCsv(join(dir, 'characteristics.csv'))) {
    if (!STATE_CLASSES.has(r.StateCode ?? '') || chars.has(r.PropertyID!)) continue;
    chars.set(r.PropertyID!, {
      cls: r.Class || null,
      year: n(r.YearBuild) > 1800 ? n(r.YearBuild) : null,
    });
  }
  log(`cad: ${chars.size} properties in classes ${[...STATE_CLASSES].join(', ')}`);

  log('cad: reading exemptions…');
  const homestead = new Set<string>();
  const ceiling = new Set<string>();
  for await (const r of readCsv(join(dir, 'exemptions.csv'))) {
    if (!chars.has(r.PropertyID!) || r.ExemptionStatusCode !== 'A') continue;
    if (r.ExemptionTypeDescription === 'Homestead') homestead.add(r.PropertyID!);
    if (CEILING.test(r.ExemptionTypeDescription ?? '')) ceiling.add(r.PropertyID!);
  }

  log('cad: reading taxing units…');
  const units = new Map<string, TaxUnitRow>();
  const perProp = new Map<string, ParcelRow['units']>();
  for await (const r of readCsv(join(dir, 'asmt.csv'))) {
    const id = r.PropertyID!;
    const code = r.TaxingUnitCode!;
    if (Number(r.AdHocTaxYear) !== year || !chars.has(id) || !code || NOT_TAXING.has(code)) {
      continue;
    }
    if (!units.has(code)) {
      const rate = rates?.rates[code];
      units.set(code, {
        code,
        name: rates?.names?.[code] ?? code,
        kind: kindOf(code),
        ratePct: rate && Number(rate) > 0 ? rate : null,
      });
    }
    // The export doesn't split exemptions by type. For homesteads outside school districts,
    // what's exempt is mostly the local-option percentage (at most 20% by law, §11.13(n)).
    const assessed = n(r.Assessed);
    const taxable = n(r.Taxable);
    const share = assessed > 0 ? ((assessed - taxable) / assessed) * 100 : 0;
    const pct =
      homestead.has(id) && kindOf(code) !== 'SCHOOL' && share > 0 && share <= 20.0001
        ? Math.round(share * 10_000) / 10_000
        : 0;
    let list = perProp.get(id);
    if (!list) perProp.set(id, (list = []));
    list.push({ code, taxableValue: String(taxable), exemptPct: String(pct) });
  }

  async function* parcels(): AsyncGenerator<ParcelRow> {
    const seen = new Set<string>();
    for await (const r of readCsv(join(dir, 'property.csv'))) {
      const id = r.PropertyID!;
      const c = chars.get(id);
      if (Number(r['Tax Year']) !== year || !c || seen.has(id)) continue;
      seen.add(id);
      const land = n(r.TotalLandMktValue);
      const market = n(r.TotalPropMktValue);
      const situs = [r.StreetNumber, r.StreetName, r.StreetSuffix].filter(Boolean).join(' ');
      yield {
        accountNumber: r.QuickRefID || id,
        stateClass: 'A1',
        neighborhoodCode: r.NeighborhoodCode || 'UNKNOWN',
        ownerName: null,
        situsLine: situs || null,
        situsZip: r.Zip || null,
        landValue: String(land),
        improvementValue: String(Math.max(0, market - land)),
        marketValue: String(market),
        appraisedValue: String(n(r.TotalAssessedValue) || market),
        livingAreaSqft: n(r.TotalSqFtLivingArea) || null,
        yearBuilt: c.year,
        qualityCode: c.cls,
        homestead: homestead.has(id),
        taxCeiling: ceiling.has(id),
        units: perProp.get(id) ?? [],
      };
    }
  }

  return replaceCountyYear(prisma, {
    countyName: 'Williamson',
    taxYear: year,
    source:
      'WCAD open data (https://data.wcad.org)' +
      (rates ? `; rates: ${rates.source}` : '; no tax rates'),
    files: { dir, datasets: DATASETS },
    notes: [
      'Williamson CAD’s open data has no owner names, so search by account number or address.',
    ],
    units: [...units.values()],
    parcels: parcels(),
  });
}
