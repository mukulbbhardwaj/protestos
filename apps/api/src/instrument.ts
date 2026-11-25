import { SENTRY_DATA_COLLECTION } from '@app/shared';
import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

/** Sentry is optional: without a DSN this is a no-op. */
export function initSentry(env: Env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_VERSION,
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0,
  });
  return true;
}
