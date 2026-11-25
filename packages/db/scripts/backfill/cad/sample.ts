import type { PrismaClient } from '../../../src/raw.js';
import { log } from '../common.js';
import { Rng } from '../sample-data.js';
import { countyIdFor, replaceCountyYear, type ParcelRow, type TaxUnitRow } from './store.js';

// A small SYNTHETIC Harris County roll for development, demos without the real download, and
// CI (spec savings-calculator.md). Accounts start with 999, which HCAD doesn't use. Loading the
// real roll (`pnpm db:backfill cad`) replaces it, and this step never overwrites a real load.

export const SAMPLE_SOURCE = 'synthetic sample (development only)';
const YEAR = 2026;

// Approximate rates for realistic-looking numbers. Not real rates; the real load brings those.
const UNITS: TaxUnitRow[] = [
  { code: '001', name: 'Houston ISD', kind: 'SCHOOL', ratePct: '0.868300' },
  { code: '040', name: 'Harris County', kind: 'COUNTY', ratePct: '0.385290' },
  { code: '041', name: 'Harris County Flood Control', kind: 'OTHER', ratePct: '0.048970' },
  { code: '042', name: 'Port of Houston Authority', kind: 'OTHER', ratePct: '0.006150' },
  { code: '043', name: 'Harris Health System', kind: 'OTHER', ratePct: '0.163480' },
  { code: '048', name: 'Houston Community College', kind: 'OTHER', ratePct: '0.092200' },
  { code: '061', name: 'City of Houston', kind: 'CITY', ratePct: '0.519190' },
];
const SCHOOL_HOMESTEAD = 140_000;
const LOCAL_HOMESTEAD_PCT = 20;

const NEIGHBORHOODS = [
  {
    code: '8401.01',
    streets: ['OAK HOLLOW DR', 'OAK BRANCH LN'],
    zip: '77024',
    land: 180_000,
    rate: 165,
    area: 2600,
  },
  {
    code: '8402.03',
    streets: ['WILLOW BEND LN', 'WILLOW CREST CT'],
    zip: '77096',
    land: 95_000,
    rate: 140,
    area: 2100,
  },
  {
    code: '8403.07',
    streets: ['CEDAR RIDGE CT', 'CEDAR POINT DR'],
    zip: '77089',
    land: 48_000,
    rate: 118,
    area: 1750,
  },
];
const FIRST = [
  'JAMES',
  'MARIA',
  'ROBERT',
  'LINDA',
  'DAVID',
  'ANA',
  'MICHAEL',
  'PATRICIA',
  'JOSE',
  'JENNIFER',
];
const LAST = [
  'GARCIA',
  'SMITH',
  'NGUYEN',
  'JOHNSON',
  'MARTINEZ',
  'BROWN',
  'LOPEZ',
  'DAVIS',
  'PATEL',
  'WILSON',
];
const GRADES = [
  ['B', 6],
  ['C', 3],
  ['A', 1],
] as const;

const round10 = (n: number) => Math.round(n / 10) * 10;

function* parcels(): Generator<ParcelRow> {
  const r = new Rng(2026);
  let seq = 0;
  for (const n of NEIGHBORHOODS) {
    for (let i = 0; i < 40; i++) {
      seq += 1;
      const area = Math.round(n.area * r.float(0.75, 1.3));
      const grade = r.weighted(GRADES);
      // Most homes sit near the neighborhood rate; some are appraised well above it.
      const perSqft = n.rate * (r.chance(0.3) ? r.float(1.08, 1.25) : r.float(0.9, 1.06));
      const land = round10(n.land * r.float(0.85, 1.15));
      const improvement = round10(area * perSqft);
      const market = land + improvement;
      const homestead = r.chance(0.7);
      const capped = homestead && r.chance(0.4);
      const appraised = capped ? round10(market * r.float(0.82, 0.97)) : market;
      const taxCeiling = homestead && r.chance(0.12);
      const units = UNITS.map((u) => {
        const school = u.kind === 'SCHOOL';
        const exemptPct = homestead && !school ? LOCAL_HOMESTEAD_PCT : 0;
        const taxable = homestead
          ? school
            ? Math.max(0, appraised - SCHOOL_HOMESTEAD)
            : Math.round((appraised * (100 - exemptPct)) / 100)
          : appraised;
        return { code: u.code, taxableValue: String(taxable), exemptPct: String(exemptPct) };
      });
      yield {
        accountNumber: `999${String(seq).padStart(10, '0')}`,
        stateClass: 'A1',
        neighborhoodCode: n.code,
        ownerName: `${r.pick(LAST)} ${r.pick(FIRST)}`,
        situsLine: `${r.int(100, 19999)} ${r.pick(n.streets)}`,
        situsZip: n.zip,
        landValue: String(land),
        improvementValue: String(improvement),
        marketValue: String(market),
        appraisedValue: String(appraised),
        livingAreaSqft: area,
        yearBuilt: r.int(1978, 2018),
        qualityCode: grade,
        homestead,
        taxCeiling,
        units,
      };
    }
  }
}

export async function backfillCadSample(prisma: PrismaClient) {
  const countyId = await countyIdFor(prisma, 'Harris');
  const existing = await prisma.cadLoad.findUnique({
    where: { countyId_taxYear: { countyId, taxYear: YEAR } },
    select: { source: true },
  });
  if (existing && existing.source !== SAMPLE_SOURCE) {
    log(`cad-sample: Harris ${YEAR} has a real roll loaded; leaving it alone`);
    return;
  }
  await replaceCountyYear(prisma, {
    countyName: 'Harris',
    taxYear: YEAR,
    source: SAMPLE_SOURCE,
    files: {},
    units: UNITS,
    parcels: parcels(),
  });
}
