import { createPrismaClient } from '@app/db/raw';
import { DevFileMailProvider, DevFileStorageProvider } from '@app/providers';
import { createPgBossQueue } from './jobs.js';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { initSentry } from './instrument.js';
import { loggerOptions } from './logger.js';

const env = loadEnv();
const sentry = initSentry(env);
const prisma = createPrismaClient(env.DATABASE_URL);

if (env.NODE_ENV === 'production') {
  // BUILD_PLAN 13.1: the email provider (Postmark or Brevo) is still undecided; M5 adds it.
  throw new Error('No production MailProvider is configured yet (M5).');
}
const mail = new DevFileMailProvider(env.DEV_MAIL_DIR);

const storage = new DevFileStorageProvider(env.STORAGE_DIR);
const jobs = await createPgBossQueue(env.DATABASE_URL);

const app = await buildApp(
  {
    prisma,
    mail,
    storage,
    jobs,
    appUrl: env.APP_URL,
    version: env.APP_VERSION,
    cookieSecure: env.COOKIE_SECURE,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    authRateLimitPerMin: env.AUTH_RATE_LIMIT_PER_MIN,
    sentry,
  },
  { logger: loggerOptions(env) },
);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await jobs.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
