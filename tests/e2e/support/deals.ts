// tests/e2e/support/deals.ts
//
// Fill UnlistedItemDialog on a private-deal compose or join form.
//
// SELECTS BEFORE TEXT — same WebKit trap as createListing (F61). Photos last.

import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { RENDERED } from './waiting';

const TEST_IMAGE = path.resolve(__dirname, '..', 'fixtures', 'test-image.png');

/**
 * Select a `ChoiceTile` by clicking the TILE, the way a member does.
 *
 * `.check()` ON THESE RADIOS HANGS, and it is not a race. Probed directly
 * (tests/e2e/debug/specs/deal-open.spec.ts): after `/deals/new` redirects to
 * `/?deal=1` the compose dialog is open and steady from ~900ms, and the radio is
 * present, visible and at a CONSTANT 1x1 box — `ChoiceTile` renders radios `sr-only`
 * (components/ui/choice-tile.tsx). So the actionability wait passes and the hit test
 * is what fails: at the input's own 1x1 coordinates the topmost element is one of the
 * tile's inner `<span>`s, which is a sibling rather than the input or its descendant.
 * Playwright retries the whole loop forever, printing "waiting for element to be
 * visible, enabled and stable" as though the control had never rendered.
 *
 * Measured on the same probe: `check()` times out, while `check({ force: true })`,
 * clicking the `<label>` and clicking the tile text all select it. Clicking the label
 * is the one that matches what a human does, so it is the one used here — `force`
 * would skip the very hit test that would catch a genuinely obscured tile.
 *
 * NOT a product defect: a member clicks the tile, never the hidden input. And NOT
 * needed for the listing form's kind tiles, whose `align="start"` layout leaves the
 * input's point on the label itself — which is why `createListing` gets away with
 * `.check()` and this had to be discovered here.
 */
export async function chooseTile(page: Page, label: RegExp | string): Promise<void> {
  const tile = page.locator('label').filter({ hasText: label });
  // Exactly one, so an ambiguous label fails here with a count rather than by
  // silently selecting whichever tile happened to come first.
  await expect(tile).toHaveCount(1, { timeout: RENDERED });
  await tile.click();
  // Checked, OR gone: the compose form's step-1 tiles advance to step 2 on pick,
  // so the tile that was clicked unmounts. Either outcome means the click landed.
  await expect(async () => {
    if ((await tile.count()) === 0) return;
    await expect(tile.getByRole('radio')).toBeChecked();
  }).toPass({ timeout: RENDERED });
}

/**
 * TWO SHAPES, ONE HELPER. The compose form renders `UnlistedItemFields` INLINE
 * (ids `deal-card-*`); the join form still opens `UnlistedItemDialog` behind a
 * "Your card" row (ids `unlisted-*`). Which one is on screen decides the path.
 */
export async function fillUnlistedCard(
  page: Page,
  description: string,
): Promise<void> {
  const inline = (await page.locator('#deal-card-game').count()) > 0;

  if (inline) {
    const scope = page.getByRole('dialog').filter({ has: page.locator('#deal-card-game') });
    await fillFields(page, scope, 'deal-card', description);
    return;
  }

  await page.getByRole('button', { name: /Your card/i }).click();

  // SCOPED TO THE INNER DIALOG, because the join form is itself inside a dialog on
  // some routes. Identified by a control only the inner dialog has, rather than by
  // an accessible name (which two nested dialogs can both satisfy) or by `.last()`
  // (which depends on portal ordering).
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.locator('#unlisted-game') });
  await expect(dialog).toBeVisible({ timeout: RENDERED });

  await fillFields(page, dialog, 'unlisted', description);

  await dialog.getByRole('button', { name: /Add card|Save card|Add to offer|Save item/i }).click();
  await expect(dialog).toBeHidden({ timeout: RENDERED });
}

/** The four card fields, selects before text (F61), photo last. */
async function fillFields(
  page: Page,
  scope: ReturnType<Page['locator']>,
  idPrefix: string,
  description: string,
): Promise<void> {
  await scope.locator(`#${idPrefix}-game`).click();
  await page.getByRole('option', { name: 'Pokémon' }).click();
  await expect(scope.locator(`#${idPrefix}-game`)).toBeFocused({ timeout: RENDERED });

  await scope.locator(`#${idPrefix}-condition`).click();
  await page.getByRole('option', { name: 'Near Mint' }).click();
  await expect(scope.locator(`#${idPrefix}-condition`)).toBeFocused({ timeout: RENDERED });

  // By id, not label: the compose form asks "What are you selling?" / "What are you
  // trading?" while the join dialog says "Describe the card".
  await scope.locator(`#${idPrefix}-description`).fill(description);
  await scope.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  await expect(scope.getByText(/1 of 10/)).toBeVisible({ timeout: 20_000 });
}
