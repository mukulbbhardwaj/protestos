// Usage: pnpm db:backfill <counties|demo|sample|all> [--reset]
//   counties  254 Texas counties (reference data; safe in production)
//   demo      demo firms and users in every role (development only)
//   sample    clients, prospects, properties and tax years for the demo firms (development only)
//   all       all of the above, in order
// Every step is idempotent: re-running adds only what is missing.
// --reset (with sample/all) first deletes the demo firms' sample data, then regenerates it.
import { assertNotProduction, connect, log } from './common.js';
import { backfillCounties } from './counties.js';
import { backfillDemoBase, DEMO_PASSWORD } from './demo.js';
import { backfillSampleData, resetSampleData } from './sample-data.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const steps = args.filter((a) => a !== '--reset');
const valid = ['counties', 'demo', 'sample', 'all'];
if (steps.length === 0 || steps.some((s) => !valid.includes(s))) {
  console.error(`Usage: pnpm db:backfill <${valid.join('|')}> [...]`);
  process.exit(1);
}
const run = (s: string) => steps.includes(s) || steps.includes('all');

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
  }
  if (run('demo') || run('sample')) {
    log(`done. Log in at http://localhost:5173/login as owner@demo.test / ${DEMO_PASSWORD}`);
  }
} finally {
  await prisma.$disconnect();
}
