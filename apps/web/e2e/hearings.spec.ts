import { expect, test } from '@playwright/test';

// M7: schedule a hearing from a property, see it on the calendar and on the property's
// stage; the finance dashboard loads for the owner. Uses the demo firm.
const SLUG = 'lone-star-demo';

test('schedule a hearing and find it on the calendar', async ({ page }) => {
  const n = Date.now() % 1_000_000;
  const counties = (await (await page.request.get('/api/counties')).json()).counties as {
    id: number;
    name: string;
  }[];
  const client = await (
    await page.request.post(`/api/orgs/${SLUG}/contacts`, {
      data: { kind: 'CLIENT', displayName: `E2E Hearing ${n}` },
    })
  ).json();
  const property = await (
    await page.request.post(`/api/orgs/${SLUG}/properties`, {
      data: {
        contactId: client.id,
        accountNumber: String(5_000_000_000_000 + n),
        countyId: counties.find((c) => c.name === 'Harris')!.id,
        taxYear: new Date().getFullYear(),
      },
    })
  ).json();

  await page.goto(`/${SLUG}/properties/${property.id}`);
  await page.getByRole('button', { name: 'Schedule' }).click();
  // Tomorrow at 10:00, local time.
  const t = new Date(Date.now() + 86_400_000);
  const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Date and time').fill(`${day}T10:00`);
  await page.getByLabel('Location').fill('HCAD Room 4');
  await page.getByRole('button', { name: 'Schedule', exact: true }).last().click();
  await expect(page.getByText('Hearing scheduled.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'HCAD Room 4' })).toBeVisible();
  await expect(page.getByText('Hearing scheduled', { exact: true }).first()).toBeVisible();

  await page.goto(`/${SLUG}/hearings?view=list&date=${day}`);
  await expect(page.getByRole('row', { name: new RegExp(`E2E Hearing ${n}`) })).toContainText(
    'HCAD Room 4',
  );
});

test('the finance dashboard shows billed, collected and outstanding', async ({ page }) => {
  await page.goto(`/${SLUG}/finance`);
  await expect(page.getByText('Year to date', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Outstanding \$/)).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Billed and collected by month' })).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Collected' })).toBeVisible();
});
