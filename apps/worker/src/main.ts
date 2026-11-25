import { SENTRY_DATA_COLLECTION } from '@app/shared';
import * as Sentry from '@sentry/node';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { loadEnv } from './env.js';
import { jobs } from './jobs.js';

const env = loadEnv();
const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.LOG_PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
});

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_VERSION,
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => {
  log.error({ err }, 'pg-boss error');
  Sentry.captureException(err);
});

await boss.start();

for (const job of jobs) {
  await boss.createQueue(job.name);
  await boss.work<object>(job.name, async (batch) => {
    try {
      await job.handle(batch, log.child({ job: job.name }));
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  });
  if (job.cron) await boss.schedule(job.name, job.cron);
}

log.info({ queues: jobs.map((j) => j.name) }, 'worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
