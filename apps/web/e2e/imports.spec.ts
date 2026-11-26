import { expect, test } from '@playwright/test';

// Uses the demo firm from `pnpm db:backfill all`. The run step needs the worker, so this
// covers upload → mapping → dry run; test/imports.test.ts runs the import itself.
// Signed in as the demo owner (auth.setup.ts); start on the dashboard.
test.beforeEach(async ({ page }) => {
  await page.goto('/lone-star-demo');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('upload a clients CSV, auto-map it and see the dry run', async ({ page }) => {
  const n = Date.now() % 1_000_000;
  const csv = [
    'Client Number,Client Name,Email,County,Account Number',
    `E2E${n},E2E Import ${n},e2e${n}@example.com,Harris,${String(9_000_000_000_000 + n)}`,
    `E2E${n}B,Bad County ${n},bad${n}@example.com,Atlantis,123`,
  ].join('\n');

  await page.goto('/lone-star-demo/imports');
  await page.getByLabel('CSV file').setInputFiles({
    name: `e2e-${n}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole('heading', { name: `e2e-${n}.csv` })).toBeVisible();
  await expect(page.getByLabel('Field for Account Number')).toHaveValue('accountNumber');

  await page.getByRole('button', { name: 'Run dry run' }).click();
  await expect(page.getByText('Dry run ready: 1 row has errors.')).toBeVisible();
  const results = page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Record' }) });
  await expect(results.getByRole('row', { name: new RegExp(`E2E Import ${n}`) })).toContainText(
    'New',
  );
  await expect(results.getByRole('row', { name: /Bad County/ })).toContainText(
    'County: "Atlantis" isn\'t a Texas county.',
  );
  await expect(page.getByRole('button', { name: 'Import 1 rows' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Error rows (1)' })).toHaveAttribute(
    'href',
    /errors\.csv$/,
  );
});
