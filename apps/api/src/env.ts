import { findWorkspaceRoot, loadRootEnv } from '@app/shared/node';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.url().default('http://localhost:5173'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z.stringbool().optional(),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  DEV_MAIL_DIR: z.string().optional(),
  /** Where uploaded files live in development (shared with the worker). S3-compatible storage later. */
  STORAGE_DIR: z.string().optional(),
  /** Signs the mail provider's webhook (M5). Required in production. */
  MAIL_WEBHOOK_SECRET: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  APP_VERSION: z.string().default('dev'),
});

export type Env = z.infer<typeof EnvSchema> & {
  COOKIE_SECURE: boolean;
  DEV_MAIL_DIR: string;
  STORAGE_DIR: string;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadRootEnv();
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  return {
    ...env,
    // Secure cookies whenever the web app is served over https.
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.APP_URL.startsWith('https://'),
    DEV_MAIL_DIR: env.DEV_MAIL_DIR ?? join(findWorkspaceRoot() ?? process.cwd(), '.dev-mail'),
    STORAGE_DIR: env.STORAGE_DIR ?? join(findWorkspaceRoot() ?? process.cwd(), '.dev-storage'),
  };
}
