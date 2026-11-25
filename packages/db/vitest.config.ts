import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'], fileParallelism: false },
});
