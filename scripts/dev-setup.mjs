// First-run bootstrap for `pnpm dev`: creates .env, starts Postgres, applies migrations.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example');
}

try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
  console.error('Docker is not running. Start Docker Desktop and run `pnpm dev` again.');
  process.exit(1);
}

run('docker compose up -d --wait');
run('pnpm --filter @app/db generate');
run('pnpm --filter @app/db migrate:deploy');
