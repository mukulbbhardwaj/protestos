import { expect, test, type Page } from '@playwright/test';

// Uses the demo data from `pnpm db:seed` (run by `pnpm dev`) and the dev mailbox.
const PASSWORD = 'demo-password';

// These tests log in (and sign up) themselves.
test.use({ storageState: { cookies: [], origins: [] } });

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('owner sees the dashboard, switches firms and edits settings', async ({ page }) => {
  await login(page, 'owner@demo.test');
  await expect(page.getByRole('heading', { name: /Welcome, Olivia/ })).toBeVisible();
  await expect(page.getByText('Get your firm set up')).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Finance/ })).toBeVisible();

  // Org switcher
  await page.getByRole('button', { name: /Lone Star Demo/ }).click();
  await page.getByRole('menuitem', { name: /Gulf Coast Demo/ }).click();
  await expect(page).toHaveURL(/\/gulf-coast-demo$/);
  await page.getByRole('button', { name: /Gulf Coast Demo/ }).click();
  await page.getByRole('menuitem', { name: /Lone Star Demo/ }).click();

  await nav.getByRole('link', { name: /Settings/ }).click();
  const phone = page.getByLabel('Phone');
  const value = `(512) 555-${String(Date.now()).slice(-4)}`;
  await phone.fill(value);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('Updated settings').first()).toBeVisible();
});

test('staff cannot see finance or settings', async ({ page }) => {
  await login(page, 'staff@demo.test');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Clients/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Finance/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Settings/ })).toHaveCount(0);

  await page.goto('/lone-star-demo/finance');
  await expect(page.getByText('You don’t have access to this page')).toBeVisible();
});

test('a new firm signs up, confirms email, creates its org and invites a teammate', async ({
  page,
}) => {
  const id = Date.now();
  const email = `founder-${id}@example.test`;

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Fran Founder');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();

  // Open the confirmation link from the dev mailbox.
  await page.goto('/dev/mailbox');
  await page
    .getByRole('button', { name: new RegExp(`To ${email}`) })
    .first()
    .click();
  await page.getByRole('link', { name: 'Open link in this tab' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue' }).click();

  await page.getByLabel('Firm name').fill(`Founder Firm ${id}`);
  await page.getByRole('button', { name: 'Create firm' }).click();
  await expect(page.getByRole('heading', { name: /Welcome, Fran/ })).toBeVisible();

  await page.goto(page.url() + '/settings/team');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Email').fill(`teammate-${id}@example.test`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
  await expect(page.getByRole('cell', { name: `teammate-${id}@example.test` })).toBeVisible();
});
