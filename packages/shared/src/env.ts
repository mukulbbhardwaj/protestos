import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Loads the monorepo root `.env` into process.env if one exists. Values already
 * set in the environment win (CI and production never use a .env file).
 */
export function loadRootEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const file = join(dir, '.env');
      if (existsSync(file)) {
        process.loadEnvFile(file);
        return file;
      }
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
