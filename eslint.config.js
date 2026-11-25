import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Tenant isolation guard (docs/BUILD_PLAN.md section 6.2): only infrastructure code may
 * touch the raw, unscoped Prisma client. Everything else goes through `@app/db`.
 */
const rawDbImportBan = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: '@app/db/raw', message: 'Use the org-scoped data layer from @app/db.' },
        { name: '@prisma/client', message: 'Use the org-scoped data layer from @app/db.' },
      ],
      patterns: [
        {
          group: ['**/generated/prisma', '**/generated/prisma/*'],
          message: 'Use the org-scoped data layer from @app/db.',
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'packages/db/src/generated/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    ignores: [
      // Allowed: process entry points and wiring that construct the client, system services
      // (auth, onboarding), the worker, and tests. Routes and plugins are not exempt: tenant
      // routes get `request.tenant.db` (forOrg) and nothing else.
      'apps/api/src/server.ts',
      'apps/api/src/app.ts',
      'apps/api/src/services/**',
      'apps/api/test/**',
      'apps/worker/src/**',
    ],
    rules: rawDbImportBan,
  },
);
