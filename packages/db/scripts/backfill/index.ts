// Usage: pnpm db:backfill <counties|demo|sample|cad-sample|all> [--reset]
//        pnpm db:backfill cad --county harris --year 2026 [--dir .data/hcad/2026]
//   counties    254 Texas counties (reference data; safe in production)
//   demo        demo firms and users in every role (development only)
//   sample      clients, prospects, properties and tax years for the demo firms (development only)
//   cad-sample  a small synthetic Harris roll for the calculator (development only)
//   all         all of the above, in order
//   cad         a county's real public appraisal roll (reference data; safe in production)
//   cad-index   recompute the equity index for every loaded county-year (safe in production)
// Every step is idempotent: re-running adds only what is missing.
// --reset (with sample/all) first deletes the demo firms' sample data, then regenerates it.
import { assertNotProduction, connect, log } from './common.js';
import { loadCollin } from './cad/collin.js';
import { loadFortBend } from './cad/fortbend.js';
import { loadHarris } from './cad/harris.js';
import { loadPacs, type PacsCounty } from './cad/pacs.js';
import { loadWilliamson } from './cad/williamson.js';
import { backfillCadSample } from './cad/sample.js';
import { computeEquityIndex } from './cad/store.js';
import { backfillCounties } from './counties.js';
import { backfillDemoBase, DEMO_PASSWORD } from './demo.js';
import { backfillSampleBilling } from './sample-billing.js';
import { backfillSampleData, resetSampleData } from './sample-data.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
/** `--name value` options, for the cad step. */
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const optionValues = new Set(['county', 'year', 'dir'].map(option).filter(Boolean));
const steps = args.filter((a) => !a.startsWith('--') && !optionValues.has(a));
const valid = ['counties', 'demo', 'sample', 'cad-sample', 'all', 'cad', 'cad-index'];
if (steps.length === 0 || steps.some((s) => !valid.includes(s))) {
  console.error(`Usage: pnpm db:backfill <${valid.join('|')}> [...]`);
  process.exit(1);
}
const run = (s: string) =>
  steps.includes(s) || (steps.includes('all') && s !== 'cad' && s !== 'cad-index');
type CadAdapter = (
  prisma: Parameters<typeof loadHarris>[0],
  opts: { year: number; dir: string },
) => Promise<number>;

// Counties publishing the Legacy 8.0.x appraisal export. Living-area rules are per county
// because detail type codes vary; see cad/pacs.ts.
const PACS_COUNTIES: Record<string, PacsCounty> = {
  travis: {
    countyName: 'Travis',
    slug: 'travis',
    livingArea: (cd, desc) =>
      /^(1ST|2ND|3RD|MA|LA)/i.test(cd) || /FLOOR|LIVING|MAIN AREA/i.test(desc),
    source: 'TCAD appraisal export (https://traviscad.org/publicinformation)',
  },
  montgomery: {
    countyName: 'Montgomery',
    slug: 'montgomery',
    // Commercial building rows have 3-digit type codes (045 Warehouse, 053 Office Building …);
    // paving, canopies and porches use letter codes.
    commercialBuilding: (cd) => /^\d{3}$/.test(cd),
    livingArea: (cd, desc) => /^(MA|LA|1ST|2ND)/i.test(cd) || /MAIN AREA|LIVING|FLOOR/i.test(desc),
    source: 'MCAD appraisal data export (https://mcad-tx.org/appraisal-data-exports)',
  },
  denton: {
    countyName: 'Denton',
    slug: 'denton',
    livingArea: (cd, desc) => /^(MA|LA|1ST|2ND)/i.test(cd) || /MAIN AREA|LIVING|FLOOR/i.test(desc),
    source: 'Denton CAD certified data (https://www.dentoncad.com/data-downloads)',
  },
};

const ratesFile = (county: string, year: number) =>
  new URL(`../../src/reference/cad-rates/${county}-${year}.json`, import.meta.url).pathname;

const CAD_ADAPTERS: Record<string, CadAdapter> = {
  harris: loadHarris,
  collin: loadCollin,
  fortbend: (prisma, opts) =>
    loadFortBend(prisma, { ...opts, ratesFile: ratesFile('fortbend', opts.year) }),
  williamson: (prisma, opts) =>
    loadWilliamson(prisma, { ...opts, ratesFile: ratesFile('williamson', opts.year) }),
  ...Object.fromEntries(
    Object.entries(PACS_COUNTIES).map(([key, county]) => [
      key,
      ((prisma, opts) =>
        loadPacs(prisma, county, { ...opts, ratesFile: ratesFile(key, opts.year) })) as CadAdapter,
    ]),
  ),
};

const prisma = connect();
try {
  if (run('counties')) await backfillCounties(prisma);
  if (run('demo')) {
    assertNotProduction('demo users');
    await backfillDemoBase(prisma);
  }
  if (run('sample')) {
    assertNotProduction('sample data');
    if (reset) await resetSampleData(prisma);
    await backfillSampleData(prisma);
    await backfillSampleBilling(prisma);
  }
  if (run('cad-sample')) {
    assertNotProduction('the synthetic CAD roll');
    await backfillCadSample(prisma);
  }
  if (run('cad')) {
    const county = (option('county') ?? '').toLowerCase();
    const year = Number(option('year'));
    const adapter = CAD_ADAPTERS[county];
    if (!adapter || !Number.isInteger(year)) {
      throw new Error(
        `Usage: pnpm db:backfill cad --county <${Object.keys(CAD_ADAPTERS).join('|')}> --year <yyyy> [--dir <folder>]`,
      );
    }
    const root = new URL('../../../../', import.meta.url).pathname;
    await adapter(prisma, { year, dir: option('dir') ?? `${root}.data/${county}/${year}` });
  }
  if (run('cad-index')) {
    const loads = await prisma.cadLoad.findMany({
      select: { countyId: true, taxYear: true, county: { select: { name: true } } },
    });
    for (const l of loads) {
      const n = await computeEquityIndex(prisma, l.countyId, l.taxYear);
      // The data changed: a new loadedAt refreshes caches keyed on it (API facets, admin page).
      await prisma.cadLoad.update({
        where: { countyId_taxYear: { countyId: l.countyId, taxYear: l.taxYear } },
        data: { loadedAt: new Date() },
      });
      log(`cad-index: ${l.county.name} ${l.taxYear}: ${n} properties indexed`);
    }
  }
  if (run('demo') || run('sample')) {
    log(`done. Log in at http://localhost:5173/login as owner@demo.test / ${DEMO_PASSWORD}`);
  }
} finally {
  await prisma.$disconnect();
}
