// tests/e2e/specs/offers.spec.ts
//
// Offer negotiation: make, decline, counter, and accept-into-a-Cash_Sale.
//
// REPEATABILITY IS THE DESIGN CONSTRAINT HERE, and it decides which item each
// block uses. Accepting an offer opens a Cash_Sale, which flips `items.status` to
// RESERVED, and nothing in this suite puts it back. A block that accepts against a
// seed item passes once and then fails forever with "no longer available" — and
// takes the catalog specs with it, because availability is visibility, so the item
// disappears from the catalog other tests assert on. So:
//
//   * DECLINE runs against Erin's seed penny. Declining changes no item state, so
//     it is repeatable as-is.
//   * COUNTER → ACCEPT creates its own listing first, marked, which teardown then
//     deletes along with the sale and the offers.
//
// DIALOG FIELDS, read off the running page (tests/e2e/debug/inspect.spec.ts):
//   Make an offer  — checkbox "I confirm this is the seller I intend to pay…",
//                    input "Your offer", textarea "Message (optional)",
//                    button "Send offer". Submitting redirects to /offers.
//   Counter offer  — input "Your counter", textarea "Message (optional)",
//                    button "Send counter".
//   Seller sees    — buttons "Accept" / "Decline" / "Counter".
//   Proposer sees  — button "Withdraw" only. You cannot accept your own offer, so
//                    whose turn it is can be read off which controls exist.
//
// Offer notes are MARKED (`offers.message`). Every participant here is a seeded
// member, so the marked-profile walk in cleanup cannot reach these rows; the note
// is what makes them findable. See scripts/e2e/cleanup-test-data.ts.

import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { ALICE, CAROL, ERIN, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
import { ensureSavedCard } from '../support/payments';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, CAROL, ERIN]);
});

/** Erin's AVAILABLE penny, $49.99. Only ever declined here, so state is unchanged. */
const ERIN_PENNY = 'cccccccc-0000-0000-0000-000000000001';

/** Cold-compile budget for a route this run has not visited yet (see F5). */
const COLD_ROUTE = 30_000;

/** Marked titles contain `[` and `]`, which are regex metacharacters. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Make an offer on a listing and land back on /offers. */
async function makeOffer(page: Page, itemId: string, dollars: string, note: string) {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: 'Make an offer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // If an identity confirmation checkbox is present, check it.
  const checkbox = dialog.getByRole('checkbox');
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check();
  }
  await dialog.getByLabel('Your offer').fill(dollars);
  await dialog.getByLabel(/Message/i).fill(note);
  await dialog.getByRole('button', { name: 'Send offer' }).click();

  await expect(page).toHaveURL(/\/offers/, { timeout: COLD_ROUTE });
  await page.waitForLoadState('domcontentloaded');
}

test.describe.serial('Offer declined', () => {
  const note = marked(`decline ${Date.now()}`);

  test('the buyer makes an offer and can only withdraw it', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(CAROL) });
  const page = await ctx.newPage();
  
  await makeOffer(page, ERIN_PENNY, '40.00', note);
  
  await expect(page.getByText('$40.00').first()).toBeVisible({ timeout: 15_000 });
  
  // Whose turn it is, expressed as which controls exist. The proposer gets
  // Withdraw and must NOT be offered Accept — accepting your own offer would be
  // a one-sided contract.
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  
  await ctx.close(); });

  test('the seller sees it and declines', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ERIN) });
  const page = await ctx.newPage();
  
  await page.goto('/offers');
  await page.waitForLoadState('domcontentloaded');
  
  await expect(page.getByText('$40.00').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Counter' })).toBeVisible();
  
  await page.getByRole('button', { name: 'Decline' }).click();
  const confirm = page.getByRole('dialog');
  if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await confirm.getByRole('button', { name: 'Decline offer' }).click();
  }
  
  // Declined is terminal, so every action retires.
  await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0, {
    timeout: 20_000,
  });
  await ctx.close(); });

  test('the buyer finds it under Past', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(CAROL) });
  const page = await ctx.newPage();
  
  // A settled offer leaves the Active list — the section filter is the only way
  // back to it.
  await page.goto('/offers?show=past');
  await page.waitForLoadState('domcontentloaded');
  
  await expect(page.getByText('$40.00').first()).toBeVisible({ timeout: 15_000 });
  await ctx.close(); });
});

test.describe.serial('Offer countered then accepted', () => {
  const listingTitle = marked(`Offer target ${Date.now()}`);
  const buyerNote = marked(`counter-flow buy ${Date.now()}`);
  const sellerNote = marked(`counter-flow sell ${Date.now()}`);
  /** Set by the first test; the rest of the block depends on it. */
  let itemId = '';

  test('the seller lists an item', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  // Its own listing, not a fixture: this block ends by reserving whatever it
  // negotiates over. See the file header.
  const url = await createListing(page, { title: listingTitle, priceDollars: '80.00' });
  itemId = new URL(url).pathname.split('/').pop() ?? '';
  expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
  
  await ctx.close(); });

  test('the buyer offers under asking', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(CAROL) });
  const page = await ctx.newPage();
  
  await makeOffer(page, itemId, '60.00', buyerNote);
  await expect(page.getByText('$60.00').first()).toBeVisible({ timeout: 15_000 });
  
  await ctx.close(); });

  test('the seller counters', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  await page.goto('/offers');
  await page.waitForLoadState('domcontentloaded');
  
  await page.getByRole('button', { name: 'Counter' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('heading', { name: 'Counter offer' })).toBeVisible();
  
  await dialog.getByLabel('Your counter').fill('70.00');
  await dialog.getByLabel(/Message/i).fill(sellerNote);
  await dialog.getByRole('button', { name: 'Send counter' }).click();
  
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  
  // The counter is now the seller's own live offer, so the turn flips: she can
  // withdraw, and is no longer being asked to accept.
  await expect(page.getByText('$70.00').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  
  await ctx.close(); });

  // A "buyer has no saved card" test used to live here and has been moved to
  // tests/unit/cashSaleErrors.test.ts. It is not repeatable as an e2e: a saved card
  // persists in the database and teardown does not remove payment methods, so the
  // no-card state exists exactly once per member per environment. The test passed,
  // then permanently asserted the opposite of what it was named for.
  //
  // What it was really checking — that a refusal code maps to actionable copy and
  // that the keys match `CashSaleError` — is pure, so it belongs in a unit test
  // where it runs on every commit and cannot rot.

  test('the buyer saves a card, accepts, and a Cash_Sale opens', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(CAROL) });
  const page = await ctx.newPage();
  
  // The precondition the previous test just proved is enforced. Any listing the
  // buyer does not own will do as an entry point to the card form.
  await ensureSavedCard(page, ERIN_PENNY);
  
  await page.goto('/offers');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('$70.00').first()).toBeVisible({ timeout: 20_000 });
  
  await page.getByRole('button', { name: 'Accept' }).click();
  
  // WAITED FOR, not probed with `isVisible()`. An immediate visibility check
  // returns false before the dialog mounts, the branch is skipped, nothing is
  // confirmed, and the offer sits Pending while the test blames the redirect.
  //
  // The trigger is "Accept" and the confirmation is "Accept offer", so the
  // confirm button must be matched EXACTLY — `/Accept/i` matches both and can
  // re-click the trigger underneath the dialog.
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await confirm.getByRole('button', { name: 'Accept offer' }).click();
  
  // Acceptance IS the Commitment_Point: it opens the contract room at the agreed
  // price.
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  
  await ctx.close(); });

  test('the item is now reserved and out of the catalog', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ERIN) });
  const page = await ctx.newPage();
  
  // Availability is VISIBILITY: a listing under contract leaves the catalog
  // rather than showing as unavailable. Checked as a third party, because the
  // buyer and seller both keep their own routes into it.
  await page.goto(`/listings?q=${encodeURIComponent(listingTitle)}`);
  await page.waitForLoadState('domcontentloaded');
  
  // ASSERT ON THE ABSENCE OF A LINK, not of the text. A search page echoes its
  // own query — in the search field's value and in the "no results for …" copy —
  // so `getByText(title)` matches the QUERY and reports the item as still
  // present. Only a link is a route into the listing.
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(listingTitle)) })).toHaveCount(0);
  
  await ctx.close(); });
});
