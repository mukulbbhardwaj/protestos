import { expect, test } from '@playwright/test';

// Uses the demo firm and the Harris roll from `pnpm db:backfill all` (the synthetic
// `cad-sample` roll) or a real `pnpm db:backfill cad` load. Spec savings-calculator.md §8.6.
// Signed in as the demo owner (auth.setup.ts); start on the dashboard.
test.beforeEach(async ({ page }) => {
  await page.goto('/lone-star-demo');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('search the roll, see an estimate and create a prospect from it', async ({ page }) => {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Calculator' })
    .click();
  await expect(page.getByRole('heading', { name: 'Savings calculator' })).toBeVisible();
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByRole('textbox', { name: 'Account number, address or owner' }).fill('oak');

  // Earlier runs may have turned the first few accounts into prospects already, so take the
  // first one that can still be added.
  const results = page.getByRole('list', { name: 'Accounts found' }).getByRole('listitem');
  await expect(results.first()).toBeVisible();
  const count = await results.count();
  let created = false;
  for (let i = 0; i < count && !created; i++) {
    await results.nth(i).getByRole('button').click();
    await expect(page.getByText('Appraisal district record')).toBeVisible();
    await expect(page.getByText(/Not a guarantee of any result/)).toBeVisible();
    const create = page.getByRole('button', { name: 'Create prospect' });
    if (await create.isVisible()) {
      await create.click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name').fill(`E2E Calculator ${Date.now()}`);
      await dialog.getByRole('button', { name: 'Create prospect' }).click();
      created = true;
    } else {
      await page.getByRole('button', { name: 'Back to results' }).click();
    }
  }
  expect(created).toBe(true);

  await expect(page.getByText('Prospect added with this property.')).toBeVisible();
  await expect(page).toHaveURL(/\/contacts\/\d+$/);
  await expect(page.getByRole('heading', { name: /E2E Calculator/ })).toBeVisible();
});

test('browse the roll with filters and open an estimate', async ({ page }) => {
  await page.goto('/lone-star-demo/calculator');
  await expect(page.getByRole('tab', { name: 'Browse & filter' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('Property type').selectOption('RESIDENTIAL');
  await page.getByLabel('Above neighbors by at least (%)').fill('10');
  await page.getByLabel('Above neighbors by at least (%)').press('Enter');
  await expect(page).toHaveURL(/minEquity=10/);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  // Every row is at least 10% above its neighbors.
  for (const badge of await page.locator('tbody tr td:last-child').allTextContents()) {
    expect(Number(badge.replace(/[+%]/g, ''))).toBeGreaterThanOrEqual(10);
  }
  await rows.first().click();
  await expect(page.getByText('Appraisal district record')).toBeVisible();
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(page).toHaveURL(/minEquity=10/);
});
