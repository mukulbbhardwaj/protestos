// Raw, tenant-unscoped database access. Only infrastructure code may import this
// (the API's db plugin, the worker, migrations and seeds). Route handlers must use
// the org-scoped layer from `@app/db` instead; ESLint enforces this.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { PrismaClient };

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
