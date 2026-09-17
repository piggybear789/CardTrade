// tests/e2e/specs/journeys.spec.ts
//
// FREQUENT USER PATHWAYS, driven as journeys rather than page loads. These run in
// both Playwright projects (desktop Chrome, iPhone 14 WebKit), so each pathway is
// exercised at the two viewports where the layout and navigation differ most.
//
// Why journeys in addition to the screenshot matrix: a route can render perfectly
// and still be unusable — a control hidden under fixed chrome, a filter that does
// not survive navigation, a bottom-nav hub that never opens. Those only fail when
// something is actually clicked in sequence.
//
// THE SUBJECT LISTING IS CREATED HERE, NOT TAKEN FROM `seed.sql`. The seeded items
// are the obvious thing to browse to, and the first version of this file did exactly
// that — then failed with "0 listings" on a catalog that was working, because the
// seeded item rows had been removed from the environment while the seeded PROFILES
// were still there. A journey that asserts on data it did not create reports the
// fixture as a product defect, which is the failure mode this whole audit exists to
// avoid. Everything below is marker-prefixed, so global teardown reclaims it.

import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';
import { messageSellerFromListing } from '../support/messageSeller';
import { clickForWrite, clickThrough, COLD_ROUTE, RENDERED } from '../support/waiting';

/**
 * One AVAILABLE listing of Alice's, plus a second that must NOT match a search for
 * the first. Both carry a nonce so a locator can name exactly one of them.
 */
interface JourneyListing {
  itemId: string;
  /** Unique token present in the derived `items.title`, so it is the link's name. */
  nonce: string;
  title: string;
}

let subject: JourneyListing;
let control: JourneyListing;

/** A token that survives full-text indexing and matches nothing else in the DB. */
function nonce(): string {
  return `jrny${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
  // Re-raised AFTER session repair, which sets its own budget (90s + 100s per user)
  // and would otherwise cap this hook well short of two listing publishes on mobile
  // WebKit. Same reasoning as `provisionAuditFixtures`.
  test.setTimeout(12 * 60_000);

  const context = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await context.newPage();
  try {
    const make = async (label: string): Promise<JourneyListing> => {
      const token = nonce();
      const title = marked(`journey ${label} ${token}`);
      const url = await createListing(page, {
        title,
        priceDollars: label === 'subject' ? '45.00' : '65.00',
        description: 'Created by the journey audit.',
      });
      return { itemId: itemIdFromUrl(url), nonce: token, title };
    };
    subject = await make('subject');
    control = await make('control');
    await context.storageState({ path: storageStatePath(ALICE) });
  } finally {
    await context.close();
  }
});

/** True when the run is the phone project, where chrome and nav differ. */
function isPhone(page: Page): boolean {
  const size = page.viewportSize();
  return (size?.width ?? 1280) < 768;
}

/**
 * Nothing a member can tap may sit under the fixed phone hub bar.
 *
 * This is the F38 symptom stated as an assertion: scroll to the end of the page,
 * then check that no interactive element overlaps the bar's rectangle. Desktop has
 * no such bar, so the check no-ops there.
 */
async function expectNothingUnderMobileNav(page: Page, where: string): Promise<void> {
  if (!isPhone(page)) return;
  const obscured = await page.evaluate(() => {
    const nav = document.querySelector('[aria-label="Marketplace hubs"]');
    if (!nav) return [];
    window.scrollTo(0, document.documentElement.scrollHeight);
    const navRect = nav.getBoundingClientRect();
    if (navRect.height === 0) return [];
    return Array.from(
      document.querySelectorAll('button, a[href], input, textarea, select'),
    )
      .filter((element) => !nav.contains(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width === 0 || rect.height === 0) return false;
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        return (
          rect.bottom > navRect.top + 2 &&
          rect.top < navRect.bottom - 2 &&
          rect.right > navRect.left &&
          rect.left < navRect.right
        );
      })
      .map((element) => {
        const text = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
        return `${element.tagName.toLowerCase()} “${text || element.getAttribute('aria-label') || ''}”`;
      });
  });
  expect(obscured, `${where}: controls sit under the fixed phone hub bar`).toEqual([]);
}

// ─── 1. Guest discovery → listing → gated action ─────────────────────────────
//
// The top of the funnel, and the most travelled path in the product: arrive on the
// catalog, look at something, try to act, get sent to sign-in with the destination
// preserved.

test.describe('guest discovery pathway', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a guest can browse, open a listing, and is offered sign-in to buy', async ({
    page,
  }) => {
    // Searched rather than scrolled: the catalog is newest-first and a parallel
    // project's fixtures publish into the same grid, so "the first card" is not a
    // stable way to reach a known listing.
    await page.goto(`/?q=${subject.nonce}`);
    await page.waitForLoadState('domcontentloaded');

    const card = page.getByRole('link', { name: new RegExp(subject.nonce, 'i') }).first();
    await expect(card).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'catalog');

    // `clickThrough`, not `click`: the catalog's mosaic-to-grid hydration swap drops
    // a click that lands in its window. See the helper, and the finding it names.
    await clickThrough(card, /\/listings\/[0-9a-f-]{36}/);

    // The buy path for a guest is an invitation to sign in that REMEMBERS the item,
    // not a dead button. The phone renders it in the sticky buyer bar, desktop in
    // the actions panel; both are in the DOM at both viewports, so the visible one
    // is what this asserts on. NOT the header's "Sign in", which remembers the
    // catalog instead and comes first in the document.
    const signIn = page
      .getByRole('link', { name: /^Sign in( to buy)?$/i })
      .filter({ visible: true })
      .first();
    await expect(signIn).toBeVisible({ timeout: RENDERED });
    await signIn.click();

    // The destination may arrive encoded or not depending on which control was used;
    // what matters is that the item survives the redirect.
    await expect(page).toHaveURL(
      /\/sign-in\?redirectTo=(%2F|\/)listings(%2F|\/)[0-9a-f-]{36}/,
      { timeout: COLD_ROUTE },
    );
    await expect(page.getByLabel('Email')).toBeEditable({ timeout: RENDERED });
  });

  test('catalog search narrows results and survives a reload', async ({ page }) => {
    await page.goto(`/?q=${subject.nonce}`);
    await page.waitForLoadState('domcontentloaded');

    const hit = page.getByRole('link', { name: new RegExp(subject.nonce, 'i') });
    const miss = page.getByRole('link', { name: new RegExp(control.nonce, 'i') });

    await expect(hit.first()).toBeVisible({ timeout: RENDERED });
    await expect(miss).toHaveCount(0);

    // URL-driven state is the rule this asserts: a shared or reloaded search must
    // reproduce the same result set.
    await page.reload();
    await expect(hit.first()).toBeVisible({ timeout: RENDERED });
    await expect(miss).toHaveCount(0);
  });
});

// ─── 2. Buyer: watchlist → saved → message the seller ────────────────────────
//
// The two things a buyer does far more often than buying: save something, and ask
// the seller a question.

test.describe('buyer save and enquire pathway', () => {
  test.use({ storageState: storageStatePath(BOB) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [BOB]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(BOB) });
  });

  test('saving a listing puts it on /saved, and unsaving removes it', async ({ page }) => {
    await page.goto(`/listings/${subject.itemId}`);
    await page.waitForLoadState('domcontentloaded');

    // Both viewports render the listing's action stack twice (phone bar + desktop
    // pane), so every control here is filtered to the instance on screen.
    const save = page
      .getByRole('button', { name: /^Save item$/ })
      .filter({ visible: true })
      .first();
    const unsave = page
      .getByRole('button', { name: /^Remove from saved items$/ })
      .filter({ visible: true })
      .first();

    // Idempotent start: a re-run against a surviving watchlist row starts saved.
    if (await unsave.count()) {
      await unsave.click();
      await expect(save).toBeVisible({ timeout: RENDERED });
    }

    // THE WRITE IS AWAITED, NOT THE ANIMATION.
    //
    // The heart is optimistic: it flips before the row exists. Going straight on to
    // `/saved` therefore raced the Server Action and lost — the page said "No Saved
    // Listings Yet" while the listing behind it showed a filled heart — and so did
    // reloading the listing, which ABORTS the in-flight POST and then correctly reports
    // an unsaved item. Waiting for the action's own response is the only step here that
    // distinguishes "saved" from "the button changed colour".
    //
    // Worth knowing beyond the test: a member who taps the heart and immediately
    // navigates loses the save with no feedback, because the toast dies with the page.
    await clickForWrite(save, `/listings/${subject.itemId}`);
    await expect(unsave).toBeVisible({ timeout: RENDERED });

    await page.reload();
    await expect(unsave).toBeVisible({ timeout: RENDERED });

    await page.goto('/saved');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('link', { name: new RegExp(subject.nonce, 'i') }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'saved');

    // Put it back, so the journey leaves no residue for the next run.
    await page.goto(`/listings/${subject.itemId}`);
    await page.waitForLoadState('domcontentloaded');
    await page
      .getByRole('button', { name: /^Remove from saved items$/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(save).toBeVisible({ timeout: RENDERED });
  });

  test('messaging the seller opens a thread that keeps the message', async ({ page }) => {
    const body = marked(`journey enquiry ${Date.now()}`);

    // Viewport-aware: desktop composes inline on the listing, the phone opens the
    // thread first. Both must end with the message visible in the thread.
    await messageSellerFromListing(page, subject.itemId, body);
    // Scoped to the thread. Desktop shows the inbox list beside the conversation, so
    // the message body is on screen twice — once as the row's preview — and an
    // unscoped `getByText` is a strict-mode violation rather than a stronger check.
    await expect(
      page.getByLabel(/^Conversation with/).getByText(body),
    ).toBeVisible({ timeout: RENDERED });

    // The thread's composer is the control most likely to be occluded on a phone,
    // because it is docked at the bottom of a full-viewport route.
    const composer = page.getByPlaceholder(/Write a message/i);
    await expect(composer).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'message thread');

    // And the inbox must now list it, which is how the member finds it again.
    await page.goto('/messages');
    await page.waitForLoadState('domcontentloaded');
    // Visibility-filtered: the inbox renders its rows twice (a phone list and the
    // desktop pane), so `.first()` alone can resolve to the copy CSS has hidden and
    // report a row that is plainly on screen as hidden.
    await expect(
      page.getByText(body).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });
  });
});

// ─── 3. Seller: publish a listing, then find it in inventory ─────────────────

test.describe('seller publish pathway', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(ALICE) });
  });

  test('publishing a listing lands on it and lists it under My Listings', async ({
    page,
  }) => {
    const title = marked(`journey listing ${nonce()}`);
    const url = await createListing(page, { title, priceDollars: '30.00' });
    const itemId = itemIdFromUrl(url);

    // The seller's own view: no buy path, an edit route, and no crash.
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({
      timeout: RENDERED,
    });
    await expect(page.getByRole('button', { name: /^Buy( now)?$/ })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /^Edit$/ }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'owner listing detail');

    await page.goto('/listings/mine');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: RENDERED });

    // Editing is reachable and pre-filled with this listing, not an empty form.
    await page.goto(`/listings/${itemId}/edit`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
      new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      { timeout: RENDERED },
    );
  });
});

// ─── 4. Phone navigation: the hub bar is the whole navigation model ──────────

test.describe('phone navigation pathway', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test('the bottom hub bar reaches contracts, selling and account', async ({ page }) => {
    test.skip(!isPhone(page), 'the hub bar is phone-only');

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const nav = page.getByRole('navigation', { name: 'Marketplace hubs' });
    await expect(nav).toBeVisible({ timeout: RENDERED });

    // A sheet hub: opening it must reveal its links.
    //
    // ASSERTED ON THE SHEET, NOT ON THE TRIGGER'S `aria-expanded`. The sheet is a modal
    // dialog, so while it is open the rest of the page — the hub bar included — is
    // `aria-hidden`, and the trigger cannot be found by role at all. That is correct
    // modal behaviour; an assertion on the trigger's state is what was wrong.
    const contracts = nav.getByRole('button', { name: /Contracts/i });
    await contracts.click();
    const sheet = page.getByRole('dialog', { name: 'Contracts' });
    await expect(sheet).toBeVisible({ timeout: RENDERED });
    const purchases = sheet.getByRole('link', { name: 'Purchases' });
    await expect(purchases).toBeVisible({ timeout: RENDERED });
    await purchases.click();
    await expect(page).toHaveURL(/\/purchases/, { timeout: COLD_ROUTE });
    await expect(
      page.getByRole('heading', { name: 'Purchases' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // A direct hub: Account is one tap, and marks itself current.
    const account = nav.getByRole('link', { name: /Account/i });
    await account.click();
    await expect(page).toHaveURL(/\/profile/, { timeout: COLD_ROUTE });
    await expect(
      page.getByRole('heading', { name: ALICE.displayName }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'profile');
  });
});

// ─── 5. Account: the three profile tabs are reachable and deep-linkable ──────

test.describe('account tabs pathway', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test('profile, verification and payouts each render their own content', async ({
    page,
  }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    const tabs = page.getByRole('navigation', { name: 'Account sections' });
    const verification = tabs.getByRole('link', { name: 'Verification' });
    const payouts = tabs.getByRole('link', { name: 'Payouts' });
    await expect(verification).toBeVisible({ timeout: RENDERED });

    // The strip switches panels with `pushState` (see `TabbedPanels`), so the
    // assertions are: the URL carries the tab, the strip marks it current, and the
    // panel that is now VISIBLE is that tab's own. Hidden panels stay mounted in
    // `<Activity>`, which is why every content locator here is visibility-filtered.
    await verification.click();
    await expect(page).toHaveURL(/tab=verification/, { timeout: COLD_ROUTE });
    await expect(verification).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByText(/Stripe/i).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });

    await payouts.click();
    await expect(page).toHaveURL(/tab=payouts/, { timeout: COLD_ROUTE });
    await expect(payouts).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByText(/payout|Owed to you/i).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // The legacy dashboard path must land on the same place rather than 404.
    await page.goto('/profile/payouts');
    await expect(page).toHaveURL(/\/profile\?tab=payouts/, { timeout: COLD_ROUTE });
    await expectNothingUnderMobileNav(page, 'payouts tab');
  });
});
