import { expect, test as setup } from '@playwright/test';

// Logs the demo owner in once and saves the session, so specs don't each hit the login rate
// limit (10 per minute in development).
export const OWNER_STATE = 'e2e/.auth/owner.json';

setup('log in as the demo owner', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.test');
  await page.getByLabel('Password').fill('demo-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.context().storageState({ path: OWNER_STATE });
});
