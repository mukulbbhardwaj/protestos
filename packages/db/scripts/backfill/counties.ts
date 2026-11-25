import type { PrismaClient } from '../../src/raw.js';
import { TX_COUNTIES } from '../../src/reference/tx-counties.js';
import { log } from './common.js';

/** Inserts missing counties and refreshes CAD names/websites. Idempotent; safe in production. */
export async function backfillCounties(prisma: PrismaClient) {
  const created = await prisma.county.createMany({ data: TX_COUNTIES, skipDuplicates: true });
  for (const c of TX_COUNTIES) {
    await prisma.county.updateMany({
      where: { state: c.state, name: c.name },
      data: { cadName: c.cadName, cadWebsite: c.cadWebsite },
    });
  }
  log(`counties: ${created.count} added, ${TX_COUNTIES.length} total`);
}
