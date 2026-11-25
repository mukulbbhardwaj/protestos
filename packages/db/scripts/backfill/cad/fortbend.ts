import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { money as n, readCsv } from './csv.js';
import type { RateFile } from './pacs.js';
import { replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';

// Fort Bend Central Appraisal District, Orion exports (spec savings-calculator.md §4, ADR 006).
// https://www.fbcad.org/certified-and-supplements-reports/ publishes two zips; unzip both under
// `dir` (nested zips included):
//   certified    "Orion <year> Certified Export": PropertyExport (state codes), OwnerExport,
//                EntityExport (per taxing unit: assessed, taxable, exemptions taken),
//                ExemptionExport (exemption codes)
//   propertydata monthly "Property Data Export": PropertyDataExport*.txt files, told apart by
//                their header — property (values, neighborhood, living area, situs) and
//                segments (class and year built of each building part)
// The certified zip has no tax rates; they come from a rate file like the other counties.

const STATE_CLASSES = ['A1'];
const NOT_TAXING = new Set(['CAD']);

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f));
}

function firstLine(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const read = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read).toString('utf8').split(/\r?\n/)[0]!;
  } finally {
    closeSync(fd);
  }
}

/** Monthly export files are numbered, not named; pick each by a column only it has. */
function findByHeader(files: string[], column: string): string {
  const found = files.find(
    (f) => /PropertyDataExport\d+\.txt$/i.test(f) && firstLine(f).includes(`"${column}"`),
  );
  if (!found) throw new Error(`No Fort Bend PropertyDataExport file with a ${column} column.`);
  return found;
}

function findBySuffix(files: string[], suffix: string): string {
  const found = files.find((f) => f.endsWith(suffix));
  if (!found) throw new Error(`No Fort Bend *${suffix}. Unzip the certified export first.`);
  return found;
}

function kindOf(code: string): TaxUnitRow['kind'] {
  // FBCAD codes: S = school, C = city, G = county; D, M, W, R, F … are districts.
  if (code.startsWith('S')) return 'SCHOOL';
  if (code.startsWith('C')) return 'CITY';
  if (code.startsWith('G')) return 'COUNTY';
  return 'OTHER';
}

export async function loadFortBend(
  prisma: PrismaClient,
  opts: { year: number; dir: string; ratesFile?: string },
) {
  const { year, dir } = opts;
  const files = filesIn(dir);
  const rates: RateFile | null =
    opts.ratesFile && existsSync(opts.ratesFile)
      ? (JSON.parse(readFileSync(opts.ratesFile, 'utf8')) as RateFile)
      : null;
  if (!rates) log(`cad: no tax-rate file for Fort Bend ${year}; savings need rates`);

  log('cad: Fort Bend: finding residential properties…');
  const wanted = new Set<string>();
  for await (const r of readCsv(findBySuffix(files, '_PropertyExport.txt'))) {
    const code = (r.StateCodeImp || r.StateCodeLand || '').toUpperCase();
    if (r.PropertyTypeCode?.startsWith('R') && STATE_CLASSES.some((c) => code.startsWith(c))) {
      wanted.add(r.PropertyQuickRefID!);
    }
  }
  log(`cad: ${wanted.size} properties in classes ${STATE_CLASSES.join(', ')}`);

  log('cad: reading owners and exemptions…');
  const ownerOf = new Map<string, string>(); // owner ref → property ref (first owner wins)
  const ownerName = new Map<string, string>();
  for await (const r of readCsv(findBySuffix(files, '_OwnerExport.txt'))) {
    const prop = r.PropertyQuickRefID!;
    if (!wanted.has(prop) || ownerName.has(prop)) continue;
    ownerOf.set(r.OwnerQuickRefID!, prop);
    ownerName.set(prop, r.OwnerName || '');
  }
  const codes = new Map<string, Set<string>>();
  for await (const r of readCsv(findBySuffix(files, '_ExemptionExport.txt'))) {
    const prop = ownerOf.get(r.OwnerQuickRefID!);
    if (!prop) continue;
    const set = codes.get(prop) ?? new Set<string>();
    set.add(r.ExemptionCode!);
    codes.set(prop, set);
  }

  log('cad: reading taxing units…');
  const units = new Map<string, TaxUnitRow>();
  const perProp = new Map<string, ParcelRow['units']>();
  const over65 = new Set<string>();
  for await (const r of readCsv(findBySuffix(files, '_EntityExport.txt'))) {
    const prop = ownerOf.get(r.OwnerQuickRefID!);
    const code = r.EntityCode!;
    if (!prop || !code || NOT_TAXING.has(code)) continue;
    if (!units.has(code)) {
      const rate = rates?.rates[code];
      units.set(code, {
        code,
        name: rates?.names?.[code] ?? code,
        kind: kindOf(code),
        ratePct: rate && Number(rate) > 0 ? rate : null,
      });
    }
    // Over-65 shows as amounts taken, not as an exemption code.
    if (n(r.OALocalTaken) > 0 || n(r.OAStateTaken) > 0) over65.add(prop);
    const assessed = n(r.AssessedValue);
    // The local-option homestead is a percentage of value: the share taken is the margin.
    const pct = assessed > 0 ? Math.min(100, (n(r.HSLocalTaken) / assessed) * 100) : 0;
    let list = perProp.get(prop);
    if (!list) perProp.set(prop, (list = []));
    list.push({
      code,
      taxableValue: String(n(r.TaxableValue)),
      exemptPct: String(Math.round(pct * 10_000) / 10_000),
    });
  }

  log('cad: reading building segments…');
  // prop → [class, year built] of its largest main-area segment.
  const segments = new Map<string, { cls: string | null; year: number | null; area: number }>();
  for await (const r of readCsv(findByHeader(files, 'ActYrBuilt'))) {
    const prop = r.QuickRefID!;
    if (!wanted.has(prop) || !/^MA/i.test(r.Type ?? '')) continue;
    const area = n(r.Area);
    const prev = segments.get(prop);
    if (prev && prev.area >= area && prev.year) continue;
    segments.set(prop, {
      cls: r.Class || prev?.cls || null,
      year: n(r.ActYrBuilt) > 1800 ? n(r.ActYrBuilt) : (prev?.year ?? null),
      area,
    });
  }

  async function* parcels(): AsyncGenerator<ParcelRow> {
    const seen = new Set<string>();
    for await (const r of readCsv(findByHeader(files, 'CurrMarketValue'))) {
      const prop = r.QuickRefID!;
      if (!wanted.has(prop) || seen.has(prop)) continue;
      seen.add(prop);
      const land = n(r.CurrLandValue);
      const market = n(r.CurrMarketValue);
      const seg = segments.get(prop);
      const exemptions = codes.get(prop) ?? new Set<string>();
      const situs = [
        r.SitusPreDirectional,
        r.SitusStreetNumber,
        r.SitusStreetName,
        r.SitusStreetSuffix,
      ]
        .filter(Boolean)
        .join(' ');
      yield {
        accountNumber: prop,
        stateClass: 'A1',
        neighborhoodCode: r.NbhdCode || 'UNKNOWN',
        ownerName: ownerName.get(prop) || null,
        situsLine: situs ? situs.toUpperCase() : null,
        situsZip: r.SitusZip || null,
        landValue: String(land),
        improvementValue: String(Math.max(0, market - land)),
        marketValue: String(market),
        appraisedValue: String(n(r.CurrAssessedValue) || market),
        livingAreaSqft: n(r.SquareFootage) || null,
        yearBuilt: seg?.year ?? null,
        qualityCode: seg?.cls ?? null,
        homestead: exemptions.has('HS'),
        taxCeiling: over65.has(prop) || exemptions.has('DP'),
        units: perProp.get(prop) ?? [],
      };
    }
  }

  return replaceCountyYear(prisma, {
    countyName: 'Fort Bend',
    taxYear: year,
    source:
      'FBCAD Orion certified export and monthly property data (https://www.fbcad.org/certified-and-supplements-reports/)' +
      (rates ? `; rates: ${rates.source}` : '; no tax rates'),
    files: { dir },
    units: [...units.values()],
    parcels: parcels(),
  });
}
