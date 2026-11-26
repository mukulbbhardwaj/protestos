import { expect, test, type Page } from '@playwright/test';

// M6: a prospect is sent the engagement agreement, signs on the signing page, and becomes
// SIGNED with the signed PDF on file. (The 50-162 is covered by API tests: the official form
// isn't installed in development; see packages/pdf/assets/README.md.)
const SLUG = 'lone-star-demo';

// Signed in as the demo owner (auth.setup.ts); start on the dashboard.
test.beforeEach(async ({ page }) => {
  await page.goto('/lone-star-demo');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

async function call<T>(page: Page, method: 'GET' | 'POST', path: string, data?: object) {
  const res = await page.request.fetch(`/api/orgs/${SLUG}${path}`, { method, data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test('send an agreement to a prospect, sign it, and see them marked signed', async ({
  page,
  browser,
}) => {
  const n = Date.now() % 1_000_000;
  const name = `E2E Signer ${n}`;
  const counties = (await (await page.request.get('/api/counties')).json()).counties as {
    id: number;
    name: string;
  }[];
  const prospect = await call<{ id: number }>(page, 'POST', '/contacts', {
    kind: 'PROSPECT',
    displayName: name,
    email: `signer${n}@example.com`,
  });
  await call(page, 'POST', '/properties', {
    contactId: prospect.id,
    accountNumber: String(7_000_000_000_000 + n),
    countyId: counties.find((c) => c.name === 'Harris')!.id,
    taxYear: new Date().getFullYear(),
  });

  await page.goto(`/${SLUG}/contacts/${prospect.id}`);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Send documents' }).click();
  await page.getByRole('checkbox', { name: /Form 50-162/ }).uncheck();
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await expect(
    page.getByText(`Sent 1 document to signer${n}@example.com for signature.`),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sent', exact: true })).toBeVisible();

  const docs = await call<{ items: { envelopeId: number }[] }>(
    page,
    'GET',
    `/documents?contactId=${prospect.id}`,
  );
  const env = await call<{ signingUrl: string }>(
    page,
    'GET',
    `/envelopes/${docs.items[0]!.envelopeId}`,
  );

  // The client signs in their own browser, without logging in.
  const client = await (await browser.newContext()).newPage();
  await client.goto(new URL(env.signingUrl).pathname);
  await expect(client.getByRole('heading', { name: 'Sign this document' })).toBeVisible();
  await client.getByLabel('Your full name').fill(name);
  await client.getByRole('checkbox').check();
  await client.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(client.getByRole('heading', { name: 'Signed. Thank you!' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Signed', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Signed' })).toHaveAttribute('href', /\/pdf$/);
  const contact = await call<{ status: string }>(page, 'GET', `/contacts/${prospect.id}`);
  expect(contact.status).toBe('SIGNED');
});
