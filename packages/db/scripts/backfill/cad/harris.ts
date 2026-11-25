import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';
import { readTsv } from './tsv.js';

// Harris Central Appraisal District (HCAD) adapter. Public bulk files, tab-delimited:
// https://download.hcad.org/data/CAMA/<year>/ (spec savings-calculator.md section 4, ADR 006).
//
//   real_acct.txt                       one row per account: class, neighborhood, values, area
//   building_res.txt                    residential buildings: year built, quality grade
//   building_other.txt                  commercial buildings: type, year built, quality grade
//   desc_r_02_building_type_code.txt    building type names (Code_description_real.zip)
//   jur_value.txt                       taxable value per account per taxing unit
//   jur_exempt.txt                      exemptions per account per taxing unit
//   jur_tax_dist_exempt_value_rate.txt  each unit's name, tax rates and exemption rules

const BASE_URL = 'https://download.hcad.org/data/CAMA';
const ZIPS = [
  'Real_acct_owner.zip',
  'Real_building_land.zip',
  'Real_jur_exempt.zip',
  'Code_description_real.zip',
];
/** Single-family homes (A1) and commercial property (F1), spec sections 5 and 5a. */
const STATE_CLASSES = new Set(['A1', 'F1']);
/** Over-65, disability and surviving-spouse homesteads carry the school tax ceiling (§11.26). */
const CEILING_EXEMPTIONS = new Set(['OVR', 'DIS', 'SUR', 'APO', 'APD', 'POV', 'PDS']);

/** A truncated download has no central directory, so listing it fails. */
function isWholeZip(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    execFileSync('unzip', ['-qq', '-l', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function download(dir: string, year: number) {
  mkdirSync(dir, { recursive: true });
  for (const zip of ZIPS) {
    const path = join(dir, zip);
    if (!isWholeZip(path)) {
      log(`cad: downloading ${zip} (a few hundred MB, this takes a while)…`);
      // HCAD's server sometimes drops long downloads; resume until the zip is whole.
      execFileSync(
        'curl',
        [
          '-fsSL',
          '--retry',
          '10',
          '--retry-all-errors',
          '-C',
          '-',
          '-o',
          path,
          `${BASE_URL}/${year}/${zip}`,
        ],
        { stdio: 'inherit' },
      );
    }
  }
  for (const zip of ZIPS) execFileSync('unzip', ['-o', '-q', join(dir, zip), '-d', dir]);
}

const num = (v: string | undefined) => (v && /^-?\d+(\.\d+)?$/.test(v) ? v : '0');
const int = (v: string | undefined) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function unitKind(name: string): TaxUnitRow['kind'] {
  if (/\bI\.?S\.?D\b/.test(name)) return 'SCHOOL';
  if (/^CITY OF\b/.test(name)) return 'CITY';
  if (/^HARRIS (CO|COUNTY)\b(?!.*(FLOOD|HOSP|EDUC|EMERG|ESD|MUD|WCID|UD))/.test(name)) {
    return 'COUNTY';
  }
  return 'OTHER';
}

interface UnitRules {
  unit: TaxUnitRow;
  /** Each exemption's rule in this unit: a fixed dollar amount plus a percentage of value. */
  rules: Map<string, { fixed: number; pct: number }>;
}

async function readUnits(dir: string): Promise<Map<string, UnitRules>> {
  const units = new Map<string, UnitRules>();
  for await (const r of readTsv(join(dir, 'jur_tax_dist_exempt_value_rate.txt'))) {
    if (r.RP_TYPE !== 'Real') continue;
    const code = r.tax_dist!;
    let u = units.get(code);
    if (!u) {
      // `curr` is the current-year rate once the unit has reported it; `prop` otherwise.
      const rate = Number(r.curr) > 0 ? r.curr! : Number(r.prop) > 0 ? r.prop! : null;
      u = {
        unit: { code, name: r.name!, kind: unitKind(r.name!), ratePct: rate },
        rules: new Map(),
      };
      units.set(code, u);
    }
    u.rules.set(r.exempt_cd!, {
      fixed: Number(r.exempt_val) || 0,
      pct: (Number(r.exempt_rate) || 0) * 100,
    });
  }
  return units;
}

export async function loadHarris(prisma: PrismaClient, opts: { year: number; dir: string }) {
  const { year, dir } = opts;
  if (
    ['real_acct.txt', 'building_res.txt', 'desc_r_02_building_type_code.txt'].some(
      (f) => !existsSync(join(dir, f)),
    )
  ) {
    download(dir, year);
  }

  log('cad: reading taxing units and rates…');
  const units = await readUnits(dir);

  // Memory: this holds about 1.2M accounts' worth of lookups, so keys are numbers and values
  // are flat number arrays. (Keeping substrings would pin each whole source line in memory.)
  const key = (acct: string | undefined) => (acct && /^\d+$/.test(acct) ? Number(acct) : NaN);
  const intern = new Map<string, number>();
  const names: string[] = [];
  const idx = (s: string) => {
    let i = intern.get(s);
    if (i === undefined) {
      i = names.length;
      names.push(Buffer.from(s).toString()); // a fresh copy, not a slice of the line
      intern.set(names[i]!, i);
    }
    return i;
  };
  const amount = (v: string | undefined) => (v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : -1);

  log('cad: finding residential accounts…');
  const wanted = new Set<number>();
  for await (const r of readTsv(join(dir, 'real_acct.txt'))) {
    if (STATE_CLASSES.has(r.state_class!)) wanted.add(key(r.acct));
  }
  wanted.delete(NaN);
  log(`cad: ${wanted.size} accounts in classes ${[...STATE_CLASSES].join(', ')}`);

  log('cad: reading buildings…');
  const typeNames = new Map<string, string>();
  for await (const r of readTsv(join(dir, 'desc_r_02_building_type_code.txt'))) {
    if (r.Type) typeNames.set(r.Type, r.Description || r.Type);
  }
  // acct → [year built, grade, building type] of building 1 (the main one).
  const buildings = new Map<number, [year: number | null, grade: number, use: number]>();
  for (const file of ['building_res.txt', 'building_other.txt']) {
    const commercial = file === 'building_other.txt';
    for await (const r of readTsv(join(dir, file))) {
      const k = key(r.acct);
      if (!wanted.has(k) || buildings.has(k) || r.bld_num !== '1') continue;
      const use = commercial && r.impr_tp ? idx(typeNames.get(r.impr_tp) ?? r.impr_tp) : -1;
      buildings.set(k, [int(r.date_erected), r.qa_cd ? idx(r.qa_cd) : -1, use]);
    }
  }

  log('cad: reading exemptions…');
  // acct → [unit, exemption code, amount (-1 when not certified)] repeated.
  const exemptions = new Map<number, number[]>();
  for await (const r of readTsv(join(dir, 'jur_exempt.txt'))) {
    const k = key(r.acct);
    if (!wanted.has(k) || !r.exempt_cat) continue;
    let list = exemptions.get(k);
    if (!list) exemptions.set(k, (list = []));
    list.push(idx(r.tax_district!), idx(r.exempt_cat), amount(r.exempt_val));
  }

  log('cad: reading taxable values…');
  // acct → [unit, appraised, taxable] repeated. Accounts still under protest say
  // "Not Certified" (-1 here); their taxable value is worked out from the exemption rules.
  const values = new Map<number, number[]>();
  for await (const r of readTsv(join(dir, 'jur_value.txt'))) {
    const k = key(r.acct);
    if (!wanted.has(k)) continue;
    let list = values.get(k);
    if (!list) values.set(k, (list = []));
    list.push(idx(r.tax_district!), amount(r.appraised_val), amount(r.taxable_val));
  }

  async function* parcels(): AsyncGenerator<ParcelRow> {
    for await (const r of readTsv(join(dir, 'real_acct.txt'))) {
      const k = key(r.acct);
      if (!wanted.has(k)) continue;
      const exByUnit = new Map<string, { code: string; amount: number | null }[]>();
      const ex = exemptions.get(k) ?? [];
      for (let i = 0; i < ex.length; i += 3) {
        const unit = names[ex[i]!]!;
        const list = exByUnit.get(unit) ?? [];
        list.push({ code: names[ex[i + 1]!]!, amount: ex[i + 2]! >= 0 ? ex[i + 2]! : null });
        exByUnit.set(unit, list);
      }
      const allCodes = new Set([...exByUnit.values()].flat().map((e) => e.code));
      const land = num(r.land_val);
      const market = num(r.tot_mkt_val);
      const appraised = Number(num(r.tot_appr_val));
      const building = buildings.get(k);
      const unitValues = values.get(k) ?? [];
      const parcelUnits: ParcelRow['units'] = [];
      // HCAD files over-65 and disabled exemptions under the homestead code (RES) in
      // jur_exempt.txt. They show up as a RES amount above what the homestead rule allows.
      let hiddenOver65 = false;
      for (let i = 0; i < unitValues.length; i += 3) {
        const code = names[unitValues[i]!]!;
        const unitAppraised = unitValues[i + 1]!;
        const unitTaxable = unitValues[i + 2]!;
        const base = unitAppraised > 0 ? unitAppraised : appraised;
        const rules = units.get(code)?.rules;
        let pct = 0;
        let fixed = 0;
        for (const e of exByUnit.get(code) ?? []) {
          const rule = rules?.get(e.code);
          if (!rule) continue;
          fixed += rule.fixed;
          if (
            e.code === 'RES' &&
            e.amount !== null &&
            e.amount > rule.fixed + (rule.pct / 100) * base + 1000
          ) {
            hiddenOver65 = true;
          }
          if (rule.pct <= 0) continue;
          // A partial homestead (part rented, or a part owner) gets the percentage on only
          // part of the value, so use the share the CAD actually applied when it's known.
          const applied =
            e.amount !== null && base > 0 ? ((e.amount - rule.fixed) / base) * 100 : rule.pct;
          pct += Math.max(0, Math.min(rule.pct, applied));
        }
        pct = Math.min(100, Math.round(pct * 10_000) / 10_000);
        const value =
          unitTaxable >= 0 ? unitTaxable : Math.max(0, Math.round(base * (1 - pct / 100) - fixed));
        parcelUnits.push({ code, taxableValue: String(value), exemptPct: String(pct) });
      }
      yield {
        accountNumber: r.acct!,
        stateClass: r.state_class!,
        neighborhoodCode: r.Neighborhood_Code || 'UNKNOWN',
        ownerName: r.mailto || null,
        situsLine: r.site_addr_1 && r.site_addr_1 !== '0' ? r.site_addr_1 : null,
        situsZip: r.site_addr_3 || null,
        landValue: land,
        // Everything that isn't land: main building plus extra features (pools, garages).
        improvementValue: String(Math.max(0, Number(market) - Number(land))),
        marketValue: market,
        appraisedValue: num(r.tot_appr_val),
        livingAreaSqft: int(r.bld_ar),
        yearBuilt: building?.[0] ?? int(r.yr_impr),
        qualityCode: building && building[1] >= 0 ? names[building[1]]! : null,
        propertyUse: building && building[2] >= 0 ? names[building[2]]! : null,
        marketArea: r.Market_Area_1 || null,
        homestead: allCodes.has('RES'),
        taxCeiling: hiddenOver65 || [...allCodes].some((c) => CEILING_EXEMPTIONS.has(c)),
        units: parcelUnits,
      };
    }
  }

  return replaceCountyYear(prisma, {
    countyName: 'Harris',
    taxYear: year,
    source: `HCAD public data download (${BASE_URL}/${year}/)`,
    files: { zips: ZIPS, dir },
    units: [...units.values()].map((u) => u.unit),
    parcels: parcels(),
  });
}
