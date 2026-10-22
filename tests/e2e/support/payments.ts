// tests/e2e/support/payments.ts
//
// Giving a buyer a saved card. Opening a Cash_Sale no longer needs one (a buyer may pay
// from their bank, 0158), but PAYING by card does, and so does trade collateral.
//
// The seeded profiles carry a mock `payer_id` but no attached instrument, which is a
// deliberately realistic starting state: a member exists before they have paid for
// anything. The Buy dialog therefore opens on the checkout with "No card needed yet"
// and an "Add a card" button, which is the entry point used here.
//
// Under `PAYMENTS_PROVIDER=mock` the card form offers a single "Save demo card"
// button instead of a Stripe Payment Element, because card fields are rendered by
// Stripe inside its own iframe and there is nothing for a test to type. That
// button is the whole interaction.

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wait for the Buy dialog's checkout, which renders once the saved-card read returns.
 * Returns the dialog.
 */
export async function openBuyCheckout(page: Page): Promise<Locator> {
  // THE LABEL DIFFERS BY VIEWPORT. Desktop renders "Buy now"; the phone buyer bar
  // spends its width on a shorter "Buy". A helper pinned to one of them reports the
  // other viewport as a hang.
  await page.getByRole('button', { name: /^Buy( now)?$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('heading', { name: 'Start a purchase contract' })).toBeVisible({
    timeout: 25_000,
  });
  return dialog;
}

/**
 * Ensure the signed-in member has a saved payment method, using the Buy dialog on
 * any listing they do not own as the entry point.
 *
 * Idempotent: if a card is already attached the checkout shows it and this returns
 * without saving a second one.
 *
 * @param page   a page authenticated as the BUYER
 * @param itemId any listing the buyer does not own
 */
export async function ensureSavedCard(page: Page, itemId: string): Promise<void> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const dialog = await openBuyCheckout(page);
  const addCard = dialog.getByRole('button', { name: 'Add a card' });
  if (await addCard.isVisible().catch(() => false)) {
    await addCard.click();
    await expect(dialog.getByRole('heading', { name: 'Add a payment method' })).toBeVisible({
      timeout: 20_000,
    });
    await dialog.getByRole('button', { name: /Save demo card/i }).click();
    // On success the dialog re-reads the card and returns to the checkout, now showing it.
    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible({ timeout: 25_000 });
  }

  // Leave the dialog closed so the caller starts from a clean page.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}
