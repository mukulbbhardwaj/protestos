import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Directory containing pnpm-workspace.yaml, searching upward from `startDir`. */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the monorepo root `.env` into process.env if one exists. Values already
 * set in the environment win (CI and production never use a .env file).
 */
export function loadRootEnv(startDir: string = process.cwd()): string | undefined {
  const root = findWorkspaceRoot(startDir);
  if (!root) return undefined;
  const file = join(root, '.env');
  if (!existsSync(file)) return undefined;
  process.loadEnvFile(file);
  return file;
}
