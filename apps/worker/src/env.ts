import { findWorkspaceRoot, loadRootEnv } from '@app/shared/node';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  APP_VERSION: z.string().default('dev'),
  /** Uploaded files (shared with the API). */
  STORAGE_DIR: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & { STORAGE_DIR: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadRootEnv();
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return {
    ...parsed.data,
    STORAGE_DIR:
      parsed.data.STORAGE_DIR ?? join(findWorkspaceRoot() ?? process.cwd(), '.dev-storage'),
  };
}
