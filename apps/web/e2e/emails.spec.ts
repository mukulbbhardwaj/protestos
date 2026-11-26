import { expect, test } from '@playwright/test';

// M5: firms edit their email wording with a live preview, and can go back to the built-in one.
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@demo.test');
  await page.getByLabel('Password').fill('demo-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('edit an email template with a live preview, then reset it', async ({ page }) => {
  await page.goto('/lone-star-demo/settings/emails');
  await page.getByRole('button', { name: 'Payment receipt' }).click();
  const subject = page.getByLabel('Subject');
  await expect(subject).toHaveValue('Payment received: thank you');

  await subject.fill('Thanks for your {{payment.amount}} payment');
  await expect(page.getByText('Thanks for your $500.00 payment')).toBeVisible();

  await subject.fill('Oops {{payment.amont}}');
  await expect(page.getByText(/can't use \{\{payment\.amont\}\}/)).toBeVisible();

  await subject.fill('Thanks for your {{payment.amount}} payment');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Email saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Payment receipt\s*Edited/ })).toBeVisible();

  await page.getByRole('button', { name: 'Use built-in' }).click();
  await expect(subject).toHaveValue('Payment received: thank you');
});
