import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // BUILD_PLAN 7: the fee engine must stay at 100% branch coverage.
      thresholds: {
        'src/fees/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Spec savings-calculator.md section 8: the estimate engine too.
        'src/estimate/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        // BUILD_PLAN 10: normalizers are pure functions with high coverage.
        'src/normalize/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
