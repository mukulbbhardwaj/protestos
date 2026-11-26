import { findWorkspaceRoot, loadRootEnv } from '@app/shared/node';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.url().default('http://localhost:5173'),
  /** Comma-separated extra origins allowed to send writes, e.g. a Cloudflare tunnel URL. */
  EXTRA_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.url())),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z.stringbool().optional(),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  DEV_MAIL_DIR: z.string().optional(),
  /** dev-file (local mailbox page) or log (staging: emails written to the server log). */
  MAIL_PROVIDER: z.enum(['dev-file', 'log']).default('dev-file'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  APP_VERSION: z.string().default('dev'),
});

export type Env = z.infer<typeof EnvSchema> & { COOKIE_SECURE: boolean; DEV_MAIL_DIR: string };

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
  };
}
