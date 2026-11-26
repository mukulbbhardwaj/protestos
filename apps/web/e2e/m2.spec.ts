import { expect, test } from '@playwright/test';

// Uses the demo firm from `pnpm db:backfill all` (run by `pnpm dev`).
// Signed in as the demo owner (auth.setup.ts); start on the dashboard.
test.beforeEach(async ({ page }) => {
  await page.goto('/lone-star-demo');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('create a client, add a property, enter values and see the fee', async ({ page }) => {
  const id = Date.now();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Clients' })
    .click();
  await page.getByRole('button', { name: 'New client' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(`E2E Client ${id}`);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByRole('heading', { name: `E2E Client ${id}` })).toBeVisible();

  await page.getByRole('button', { name: /^Properties/ }).click();
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByLabel('County').selectOption({ label: 'Harris' });
  await page.getByLabel('CAD account number').fill(`E2E${id}`);
  await page.getByRole('button', { name: 'Add property' }).last().click();
  await expect(page.getByRole('heading', { name: `E2E${id}` })).toBeVisible();

  await page.getByLabel('Appraised notice value').fill('450000');
  await page.getByLabel('Appraised final value').fill('410000');
  await page.getByLabel('Combined tax rate').fill('2.15');
  // Live preview from the shared fee engine: $40,000 × 2.15% × 30% (firm default).
  await expect(page.getByTestId('fee-total')).toHaveText('$258.00');
  await page.getByRole('button', { name: /Save \d{4} values/ }).click();
  await expect(page.getByText(/values saved/)).toBeVisible();
  await expect(page.getByRole('row', { name: /\$258\.00/ })).toBeVisible();
});

test('lists, filters and global search work on the sample data', async ({ page }) => {
  await page.goto('/lone-star-demo/properties?stage=HEARING_SCHEDULED');
  await expect(page.getByText(/^[\d,]+–[\d,]+ of [\d,]+$/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Hearing scheduled' }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('textbox', { name: 'Search' }).fill('garcia');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/(contacts|properties)\/\d+$/);
});
