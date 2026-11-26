import { expect, test, type Page } from '@playwright/test';

// M4 "done when": generate → issue → partially pay → fully pay, with correct balances, and
// editing values after issue doesn't change the invoice. Uses the demo firm from
// `pnpm db:backfill all`; each run makes its own client so it can repeat.
const SLUG = 'lone-star-demo';
const year = new Date().getFullYear();

// Signed in as the demo owner (auth.setup.ts); start on the dashboard.
test.beforeEach(async ({ page }) => {
  await page.goto('/lone-star-demo');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

async function call<T>(page: Page, method: 'POST' | 'PATCH', path: string, data: object) {
  const res = await page.request.fetch(`/api/orgs/${SLUG}${path}`, { method, data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test('generate, issue, part-pay and fully pay an invoice', async ({ page }) => {
  const n = Date.now() % 1_000_000;
  const name = `E2E Billing ${n}`;
  const counties = (await (await page.request.get('/api/counties')).json()).counties as {
    id: number;
    name: string;
  }[];
  const harris = counties.find((c) => c.name === 'Harris')!;
  const client = await call<{ id: number }>(page, 'POST', '/contacts', {
    kind: 'CLIENT',
    displayName: name,
  });
  const property = await call<{ taxYears: { id: number }[] }>(page, 'POST', '/properties', {
    contactId: client.id,
    accountNumber: String(8_000_000_000_000 + n),
    countyId: harris.id,
    taxYear: year,
  });
  const yearId = property.taxYears[0]!.id;
  // 500,000 → 450,000 at 2.5% = 1,250 saved × 30% = $375.00
  await call(page, 'PATCH', `/tax-years/${yearId}`, {
    noticeAppraised: '500000',
    finalAppraised: '450000',
    taxRatePct: '2.5',
    contingencyPctOverride: '30',
  });

  await page.goto(`/${SLUG}/contacts/${client.id}`);
  await page.getByRole('button', { name: 'Billing' }).click();
  await page.getByRole('button', { name: `Invoice ${year}` }).click();
  await expect(page.getByRole('heading', { name: /Draft invoice/ })).toBeVisible();
  await expect(page.getByText('$375.00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Issue' }).click();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  const heading = page.getByRole('heading', { name: /^Invoice / });
  await expect(heading).toBeVisible();
  await expect(page.getByText('Issued', { exact: true })).toBeVisible();

  // Values edited after issue don't touch the invoice.
  await call(page, 'PATCH', `/tax-years/${yearId}`, { finalAppraised: '300000' });
  await page.reload();
  await expect(heading).toBeVisible();
  const totals = page.locator('div', { hasText: /^Total/ }).last();
  await expect(totals).toContainText('$375.00');

  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('100');
  await page.getByLabel('Reference').fill('E2E-1');
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Part paid', { exact: true })).toBeVisible();
  await expect(page.locator('div', { hasText: /^Balance/ }).last()).toContainText('$275.00');

  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('275');
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.locator('div', { hasText: /^Balance/ }).last()).toContainText('$0.00');

  // The client's billing tab agrees.
  await page.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByText('Balance due').locator('..')).toContainText('$0.00');
});
