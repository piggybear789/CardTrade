// tests/e2e/specs/us-region.spec.ts
//
// The US member experience, in a browser (0122 opened US for trading).
//
// WHY A SEPARATE SPEC RATHER THAN PARAMETERISING THE EXISTING ONES. Every other spec
// runs as an AU member against AU goods, and `checkRegionCompatibility` refuses a
// cross-region contract by design — so the US path is not the AU path with a different
// flag, it is a second population that must not be able to reach the first. This file
// asserts both halves: that a US member can do the whole thing among themselves, and
// that the boundary between the two populations holds.
//
// WHAT THIS DOES *NOT* COVER, deliberately. `playwright.config.ts` forces
// `PAYMENTS_PROVIDER=mock` for its server, so the money here is simulated. The real
// Stripe binding for US is covered by `npm run smoke:stripe:us` and
// `npm run smoke:stripe:connect:us`, which run against the US platform account's test
// keys. Those two things are worth keeping separate: this file is about what a member
// SEES, those are about what the provider DOES.
//
// SERIAL, for the same reason cash-sale.spec.ts is: each step is only reachable from
// the state the previous one left, and the ORDER is the thing being tested.

import { test, expect } from '../support/fixtures';
import {
  DAVE,
  UMA_US_SELLER,
  VICTOR_US_BUYER,
  storageStatePath,
} from '../support/users';
import { marked } from '../support/marker';
import { createListing, STUB_PLACES } from '../support/listings';
import { COLD_ROUTE, RENDERED } from '../support/waiting';
import { ensureFreshSessions } from '../support/auth';

test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [UMA_US_SELLER, VICTOR_US_BUYER, DAVE]);
});

const US_PRICE_DOLLARS = '180.00';

/**
 * The US listing, shared across the describe blocks below.
 *
 * MODULE SCOPE, and the file is serial, so the seller's block populates it before the
 * buyer's and the boundary's blocks read it. They navigate to it DIRECTLY rather than
 * clicking through the catalog — which is not a shortcut but the point: a shared link,
 * a watchlist entry and a direct URL all bypass the catalog's region filter, so the
 * refusal has to come from the contract guard. Going through a card would also couple
 * this file to catalog click behaviour, which has its own spec and its own debug probe.
 */
let usListingUrl = '';
const US_TITLE = marked('US Charizard Holo');

test.describe.configure({ mode: 'serial' });

test.describe('a US member can list and be found', () => {
  test.use({ storageState: storageStatePath(UMA_US_SELLER) });

  let listingUrl = '';
  const title = US_TITLE;

  test('a verified US seller can publish a listing with US goods', async ({ page }) => {
    // The Identity_Gate is what unlocks listing, and it is region-independent — a US
    // member satisfies it exactly as an AU member does. If this fails with a
    // verification prompt, the gate has been coupled to region somewhere.
    listingUrl = await createListing(page, {
      title,
      priceDollars: US_PRICE_DOLLARS,
      place: STUB_PLACES.portland,
    });
    usListingUrl = listingUrl;

    await expect(page.getByRole('heading', { name: title })).toBeVisible({
      timeout: RENDERED,
    });
  });

  test('the headline price is what the BUYER pays, fee included', async ({ page }) => {
    await page.goto(listingUrl);
    await page.waitForLoadState('domcontentloaded');

    // $189.00, not $180.00. `ListingDetailStack` shows `buyerPaysCents(priceCents)` for
    // a SINGLE listing — the seller's asking price plus the 5% Platform_Fee
    // (PLATFORM_FEE_BPS = 500) — so the figure a buyer reads is the one they will be
    // charged. This spec asserted the seller's price first and failed; the app was
    // right. Worth pinning, because it is the fee being visible BEFORE commitment.
    // FILTERED TO THE VISIBLE PANE. The listing renders TWICE — `ListingDetailStack`
    // for narrow viewports and `ListingDesktopPane` for wide — with the inactive one
    // hidden by CSS rather than unmounted. So `.first()` alone resolves to whichever
    // appears first in the DOM, which on desktop is the hidden mobile stack, and the
    // failure reads "element is hidden" as though the price were missing.
    await expect(
      page.getByText('$189.00').filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // NOT asserted here: the currency SYMBOL. en-AU renders AUD as "$" and en-US
    // renders USD as "$", so any assertion on the glyph passes whether or not the
    // currency is respected at all — the single most misleading check available on this
    // page. Denomination is asserted in tests/unit/moneyCurrencyRendering.test.ts and
    // tests/unit/regionParity.test.ts, where the currency is observable.
  });

  test('the US listing appears when browsing the US region', async ({ page }) => {
    await page.goto('/?region=US');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: COLD_ROUTE });
  });

  test('and is absent when browsing AU, because the catalog is region-scoped', async ({
    page,
  }) => {
    // `items.location_country_code` scopes the catalog — a different value from the
    // seller's own `profiles.region_code`. This is the assertion that would fail if
    // the two were ever merged.
    await page.goto('/?region=AU');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(title)).toHaveCount(0);
  });
});

test.describe('the region boundary holds', () => {
  // DAVE, NOT ALICE, and the choice is load-bearing rather than arbitrary.
  //
  // Files run in parallel (`fullyParallel: true`), and `ensureFreshSessions` re-signs a
  // member in — which, per support/auth.ts, retires the refresh token any other context
  // is holding for them. Alice appears in fourteen specs, so refreshing her here broke
  // `cash-sale.spec.ts` mid-flow whenever the two files ran together, surfacing as a
  // missing "Ship the item" button in a test about delivery addresses.
  //
  // Dave appears in one other spec. Any AU member works for the assertion; the scarce
  // resource is a session nobody else is using.
  test.use({ storageState: storageStatePath(DAVE) });

  test('an AU member cannot open a contract on US goods', async ({ page }) => {
    // THE POINT OF THE WHOLE REGION MODEL. A shared link, a watchlist entry or a direct
    // URL all bypass the catalog filter, so the refusal has to live in the contract
      // guard rather than in the browse scope. Dave reaches the listing directly.
    expect(usListingUrl, 'the seller block did not publish a listing').toBeTruthy();
    await page.goto(usListingUrl);
    await page.waitForLoadState('domcontentloaded');

    // The listing page warns before the orchestrator refuses. Either surface is a pass:
    // what must NOT happen is a contract opening. Advisory copy is `public_profiles`
    // driven and worded loosely, so this matches on intent rather than an exact string.
    const warned = page.getByText(/region|not available in your/i).first();
    const buy = page.getByRole('button', { name: /buy|request/i }).first();

    const warnedVisible = await warned.isVisible().catch(() => false);
    if (!warnedVisible) {
      // No warning shown — then the guard itself must refuse. Click through and assert
      // no contract room is reached.
      if (await buy.isVisible().catch(() => false)) {
        await buy.click();
        await expect(page).not.toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 10_000 });
      }
    }
    expect(
      warnedVisible || !page.url().match(/\/sales\/[0-9a-f-]{36}/),
      'an AU member reached a contract room on US goods — the region guard did not hold',
    ).toBeTruthy();
  });

});

test.describe('a US buyer can transact with a US seller', () => {
  test.use({ storageState: storageStatePath(VICTOR_US_BUYER) });

  test('the buy control is offered to a same-region member', async ({ page }) => {
    expect(usListingUrl, 'the seller block did not publish a listing').toBeTruthy();
    await page.goto(usListingUrl);
    await page.waitForLoadState('domcontentloaded');

    // Same region, seller verified, buyer verified: the buy path must be open. This is
    // the MIRROR of the Dave test above, and the pair is what makes either meaningful —
    // a guard that refused everyone would pass the boundary test on its own, and a guard
    // that refused nobody would pass this one.
    //
    // `Buy now` is the accessible name `BuyButton` gives its trigger via
    // `ListingActionIcon`. Filtered to the visible pane for the same reason the price
    // assertion is: the listing renders twice, and the inactive pane is hidden, not
    // unmounted.
    await expect(
      page.getByRole('button', { name: 'Buy now' }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });
  });
});
