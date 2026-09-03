// tests/e2e/support/deals.ts
//
// Fill UnlistedItemDialog on a private-deal compose or join form.
//
// SELECTS BEFORE TEXT — same WebKit trap as createListing (F61). Photos last.

import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { RENDERED } from './waiting';

const TEST_IMAGE = path.resolve(__dirname, '..', 'fixtures', 'test-image.png');

export async function fillUnlistedCard(
  page: Page,
  description: string,
): Promise<void> {
  await page.getByRole('button', { name: /Your card/i }).click();
  const dialog = page.getByRole('dialog', { name: /Your card|Describe your item/i });
  await expect(dialog).toBeVisible({ timeout: RENDERED });

  await dialog.locator('#unlisted-game').click();
  await page.getByRole('option', { name: 'Pokémon' }).click();
  await expect(dialog.locator('#unlisted-game')).toBeFocused({ timeout: RENDERED });

  await dialog.locator('#unlisted-condition').click();
  await page.getByRole('option', { name: 'Near Mint' }).click();
  await expect(dialog.locator('#unlisted-condition')).toBeFocused({ timeout: RENDERED });

  await dialog.getByLabel('Describe the item').fill(description);
  await dialog.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  await expect(dialog.getByText(/1 of 10/)).toBeVisible({ timeout: 20_000 });

  await dialog.getByRole('button', { name: /Add card|Save card/i }).click();
  await expect(dialog).toBeHidden({ timeout: RENDERED });
}
