// tests/e2e/support/payments.ts
//
// Giving a buyer a saved card, which is a hard precondition for opening ANY
// Cash_Sale — from the Buy button or by accepting an Offer.
//
// The seeded profiles carry a mock `payer_id` but no attached instrument, which is
// a deliberately realistic starting state and not an oversight: a member exists
// before they have paid for anything. The consequence for specs is that the buy
// dialog opens on "Add a payment method" rather than a checkout summary, and any
// flow that skips this step is refused with `no-payment-method`.
//
// Under `PAYMENTS_PROVIDER=mock` the card form offers a single "Save demo card"
// button instead of a Stripe Payment Element, because card fields are rendered by
// Stripe inside its own iframe and there is nothing for a test to type. That
// button is the whole interaction.

import { expect, type Page } from '@playwright/test';

/**
 * Ensure the signed-in member has a saved payment method, using the Buy dialog on
 * any listing they do not own as the entry point.
 *
 * Idempotent: if a card is already attached the dialog opens straight onto the
 * checkout view and this returns without saving a second one.
 *
 * @param page   a page authenticated as the BUYER
 * @param itemId any listing the buyer does not own
 */
export async function ensureSavedCard(page: Page, itemId: string): Promise<void> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: 'Buy now' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Wait for loading check to finish so we are on either addCard or checkout
  await expect(dialog.getByText(/Checking your payment details/i)).toBeHidden({ timeout: 15_000 }).catch(() => {});

  const addCard = dialog.getByRole('heading', { name: 'Add a payment method' });
  const checkout = dialog.getByRole('heading', { name: 'Start a purchase contract' });
  await expect(addCard.or(checkout)).toBeVisible({ timeout: 20_000 });

  if (await addCard.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Save demo card/i }).click();
    // On success the dialog re-fetches status and advances to the checkout view.
    await expect(checkout).toBeVisible({ timeout: 25_000 });
  }

  // Leave the dialog closed so the caller starts from a clean page.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}
