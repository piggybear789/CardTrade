// tests/e2e/debug/owner-slot-error.spec.ts
//
// `listing-detail-owner` is the one surface in the matrix with a server-render error:
// "Slot failed to slot onto its children. Expected a single React element child or
// `Slottable`", which Next recovers from by switching that tree to client rendering.
// The browser sees no component stack. The SERVER does — so this visits the page and
// leaves the stack in the run log for `Select-String` to find.

import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing } from '../support/listings';
import { marked } from '../support/marker';

test.describe('owner listing detail', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test('visit as owner', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const title = marked(`slot probe ${Date.now()}`);
    const url = await createListing(page, { title, priceDollars: '20.00' });

    // A HARD LOAD, not the client navigation `createListing` leaves behind. The error
    // is in the SERVER render of this route's HTML, which a client-side arrival never
    // performs — which is why the matrix (`page.goto`) sees it and the create flow does
    // not.
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(3_000);
    console.log('PROBE owner page errors', JSON.stringify(errors, null, 2));
  });
});
