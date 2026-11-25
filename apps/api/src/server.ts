import { pingDatabase } from '@app/db';
import { createPrismaClient } from '@app/db/raw';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { initSentry } from './instrument.js';
import { loggerOptions } from './logger.js';

const env = loadEnv();
const sentry = initSentry(env);
const prisma = createPrismaClient(env.DATABASE_URL);

const app = await buildApp(
  { pingDatabase: () => pingDatabase(prisma), version: env.APP_VERSION, sentry },
  { logger: loggerOptions(env) },
);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
