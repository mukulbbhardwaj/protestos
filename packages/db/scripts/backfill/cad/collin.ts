import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { money as n, readCsv } from './csv.js';
import { replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';

// Collin Central Appraisal District, published on the Texas Open Data Portal (Socrata):
// https://collincad.org/open-data-portal/ (spec savings-calculator.md section 4, ADR 006).
//   roll.csv      "Appraisal Data" for the year: one row per property, values and main improvement
//   entities.csv  "Entity List - Current Year": each taxing unit's rates and exemption rules
// The roll has no per-unit taxable value, so it is worked out here from the unit's rules.

const DATASETS: Record<number, { roll: string; entities: string }> = {
  2026: { roll: '5tkr-3759', entities: 'rwqz-r4mp' },
};
const exportUrl = (id: string) => `https://data.texas.gov/api/v3/views/${id}/export.csv`;
/** Collin reports single-family residential as category A (no A1 sub-code). */
const STATE_CLASSES = new Set(['A']);
const CEILING_EXEMPTIONS = /^(OV65|OV65S|DP|DPS)$/;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

interface UnitRules {
  unit: TaxUnitRow;
  hsState: number;
  hsLocalPct: number;
  ov65Local: number;
  ov65State: number;
  dpLocal: number;
  dpState: number;
}

function kindOf(entityType: string, name: string): TaxUnitRow['kind'] {
  const t = entityType.toLowerCase();
  if (t.includes('school') || /\bISD\b/i.test(name)) return 'SCHOOL';
  if (t === 'city') return 'CITY';
  if (t === 'county') return 'COUNTY';
  return 'OTHER';
}

function download(dir: string, year: number) {
  const ids = DATASETS[year];
  if (!ids) throw new Error(`No Collin dataset ids configured for ${year} (cad/collin.ts).`);
  mkdirSync(dir, { recursive: true });
  for (const [file, id] of [
    ['roll.csv', ids.roll],
    ['entities.csv', ids.entities],
  ] as const) {
    log(`cad: downloading Collin ${file}…`);
    execFileSync('curl', ['-fsSL', '--retry', '5', '-o', join(dir, file), exportUrl(id)], {
      stdio: 'inherit',
    });
  }
}

export async function loadCollin(prisma: PrismaClient, opts: { year: number; dir: string }) {
  const { year, dir } = opts;
  if (!existsSync(join(dir, 'roll.csv')) || !existsSync(join(dir, 'entities.csv'))) {
    download(dir, year);
  }

  const units = new Map<string, UnitRules>();
  for await (const e of readCsv(join(dir, 'entities.csv'))) {
    if (Number(e.Year) !== year || !e.entityCode) continue;
    const rate = n(e.totTaxRate);
    units.set(e.entityCode, {
      unit: {
        code: e.entityCode,
        name: e.entityName || e.entityCode,
        kind: kindOf(e.entityType ?? '', e.entityName ?? ''),
        ratePct: rate > 0 ? rate.toFixed(6) : null,
      },
      hsState: n(e.hsStateAmount),
      hsLocalPct: n(e.hsLocalPct),
      ov65Local: n(e.ov65LocalAmount),
      ov65State: n(e.ov65StateAmount),
      dpLocal: n(e.dpLocalAmount),
      dpState: n(e.dpStateAmount),
    });
  }
  log(`cad: Collin ${year}: ${units.size} taxing units`);

  async function* parcels(): AsyncGenerator<ParcelRow> {
    const seen = new Set<string>();
    for await (const r of readCsv(join(dir, 'roll.csv'))) {
      if (Number(r.propYear) !== year || r.propType !== 'Real') continue;
      if (!STATE_CLASSES.has(r.propCategoryCode ?? '') || !r.propID || seen.has(r.propID)) continue;
      seen.add(r.propID);
      const land = n(r.currValLand);
      const market = n(r.currValMarket);
      const assessed = n(r.currValAssessed) || market;
      const exemptions = list(r.exemptCodes);
      const hs = exemptions.includes('HS');
      const ov65 = exemptions.some((x) => x === 'OV65' || x === 'OV65S');
      const dp = exemptions.some((x) => x === 'DP' || x === 'DPS');
      const parcelUnits: ParcelRow['units'] = [];
      for (const code of list(r.entityCodes)) {
        const u = units.get(code);
        if (!u) continue;
        const pct = hs ? u.hsLocalPct : 0;
        const fixed =
          (hs ? u.hsState : 0) +
          (ov65 ? u.ov65State + u.ov65Local : 0) +
          (dp && !ov65 ? u.dpState + u.dpLocal : 0);
        const taxable = Math.max(0, Math.round(assessed * (1 - pct / 100) - fixed));
        parcelUnits.push({ code, taxableValue: String(taxable), exemptPct: String(pct) });
      }
      yield {
        accountNumber: r.propID,
        stateClass: r.propCategoryCode!,
        neighborhoodCode: r.nbhdCode || 'UNKNOWN',
        ownerName: r.ownerName || null,
        situsLine: r.situsConcatShort || null,
        situsZip: r.situsZip || null,
        landValue: String(land),
        improvementValue: String(Math.max(0, market - land)),
        marketValue: String(market),
        appraisedValue: String(assessed),
        livingAreaSqft: n(r.imprvMainArea) || null,
        yearBuilt: n(r.imprvYearBuilt) > 1800 ? n(r.imprvYearBuilt) : null,
        qualityCode: r.imprvClassCd || null,
        homestead: hs,
        taxCeiling: exemptions.some((x) => CEILING_EXEMPTIONS.test(x)),
        units: parcelUnits,
      };
    }
  }

  return replaceCountyYear(prisma, {
    countyName: 'Collin',
    taxYear: year,
    source: `Collin CAD on the Texas Open Data Portal (${exportUrl(DATASETS[year]!.roll)}); rates from the CAD's entity list`,
    files: { dir, datasets: DATASETS[year] },
    notes: [
      'Collin CAD’s public data doesn’t show over-65 exemptions, so a frozen school tax isn’t accounted for. Savings may be lower for owners over 65.',
    ],
    units: [...units.values()].map((u) => u.unit),
    parcels: parcels(),
  });
}
