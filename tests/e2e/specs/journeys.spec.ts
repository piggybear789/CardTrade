// tests/e2e/specs/journeys.spec.ts
//
// CROSS-AREA JOURNEYS (area `journeys`, Req 29.3, 36.5). Two parts:
//
// 1. THE TWO LIFECYCLE PATHWAYS, on the Pathway DSL (`audit/pathway.ts`), which open
//    the highlight reel (`audit/highlights.ts`, Req 36.5):
//
//      journeys.cash-sale-lifecycle  list, buy, pay by card, ship, deliver, accept, payout
//      journeys.trade-lifecycle      propose, agree, collateral, handover, accept, holds voided
//
//    Both run against the main server on real Stripe TEST mode. Each member has their
//    own recorded context, so every journey leaves one video per member (Req 29.2,
//    29.3), and every step is named for what the member does. Each action ends on a
//    short beat (`support/journeySteps.ts`) so the recording reads at a human pace.
//    What is not a member action is labelled: the carrier's delivery report is a
//    signed Ship24 fixture, the new-seller holdback is a moved timestamp, and the two
//    scheduled jobs are called on demand as `arrange` steps, exactly as Vercel Cron
//    would call them.
//
// 2. THE EVERYDAY PATHWAYS below them (guest discovery, save and enquire, publish,
//    phone navigation, account tabs), still on plain Playwright tests. They belong to
//    other areas (catalog, watchlist-sellers, listings, auth, profile-payouts) and move
//    to those areas' specs when those are migrated; until then they keep running here.
//
// Everyday pathways, driven as journeys rather than page loads. These run in
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

import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { ALICE, BOB, CAROL, DAVE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';
import { messageSellerFromListing } from '../support/messageSeller';
import { clickForWrite, clickThrough, COLD_ROUTE, RENDERED } from '../support/waiting';
import { pathway } from '../audit/pathway';
import { runJobOk } from '../audit/backend/jobs';
import { ship24Delivered } from '../audit/backend/ship24';
import { DAY_MS, rewind } from '../audit/backend/timeTravel';
import {
  acceptTradeItem,
  beat,
  completePurchase,
  confirmTradeAcceptance,
  confirmTradeHandover,
  holdStatusesInStripe,
  journeyNonce,
  openPayDialog,
  payByCardInRoom,
  proposeDeliveryTerms,
  proposeSwap,
  recordCashSaleShipment,
  reserveWithBuyNow,
  reviewTradeAcceptance,
  saleRow,
  setMeetingTerms,
  shownHoldStatuses,
  shownSaleStatus,
  shownSellerPayout,
  shownTradeState,
  tradeIdFor,
  tradeRow,
} from '../support/journeySteps';

// ─── Lifecycle journeys (Pathway DSL) ────────────────────────────────────────

/** Both lifecycles list, negotiate and complete for real; ten minutes is the budget. */
const LIFECYCLE_TIMEOUT_MS = 10 * 60_000;

/** How long a state reached through Stripe, a webhook or Realtime may take to show. */
const SETTLE_MS = 60_000;

pathway(
  {
    id: 'journeys.cash-sale-lifecycle',
    title: 'Cash sale start to finish: list, buy, pay by card, ship, deliver, accept, payout',
    area: 'journeys',
    kind: 'happy',
    provider: 'stripe',
    members: { seller: ALICE, buyer: BOB },
    viewports: 'both',
    timeout: LIFECYCLE_TIMEOUT_MS,
    knownFindings: ['F73', 'F74', 'F75', 'F77'],
  },
  async ({ step, simulated, arrange, assertState }) => {
    const title = marked(`Journey cash sale ${journeyNonce()}`);
    const trackingNumber = `E2E${journeyNonce().toUpperCase()}AU`;
    let itemId = '';
    let saleId = '';
    const status = () => saleRow<{ status: string }>(saleId, 'status').then((row) => row.status);

    await step('Alice lists a card for A$150.00', 'seller', async (page) => {
      itemId = itemIdFromUrl(await createListing(page, { title, priceDollars: '150.00', description: 'Listed by the cash-sale journey.' }));
      await beat(page);
    });

    await step('Bob opens the listing and reserves it with Buy now', 'buyer', async (page) => {
      await page.goto(`/listings/${itemId}`);
      await page.waitForLoadState('domcontentloaded');
      await beat(page);
      saleId = await reserveWithBuyNow(page);
      await beat(page);
    });

    await step('Alice opens the new sale', 'seller', async (page) => {
      await page.goto(`/sales/${saleId}`);
      await page.waitForLoadState('domcontentloaded');
      await beat(page);
    });

    await assertState('The card is reserved and the sale is agreeing terms', {
      member: 'seller',
      db: status,
      ui: (page) => shownSaleStatus(page),
      expect: 'AGREEMENT',
    });

    await step('Bob chooses delivery and gives his address', 'buyer', (page) => proposeDeliveryTerms(page));

    await step(
      'Bob reviews the total: price, postage and the card service fee',
      'buyer',
      async (page) => {
        await openPayDialog(page);
      },
      { copy: { fee: { currency: 'AUD', method: 'CARD' } } },
    );

    await step('Bob pays by card (3-D Secure when asked)', 'buyer', (page) => payByCardInRoom(page));

    await assertState('NoDitto holds the payment, and Alice sees it live', {
      member: 'seller',
      db: status,
      ui: (page) => shownSaleStatus(page),
      expect: 'ESCROW_HELD',
      timeout: SETTLE_MS,
    });

    await step('Alice posts the card and records the tracking number', 'seller', (page) =>
      recordCashSaleShipment(page, trackingNumber),
    );

    await assertState('Bob sees the parcel in transit', {
      member: 'buyer',
      db: status,
      ui: (page) => shownSaleStatus(page),
      expect: 'IN_TRANSIT',
      timeout: SETTLE_MS,
    });

    await simulated(
      'Australia Post reports the parcel delivered',
      { mechanism: 'signed-fixture', reason: 'A Ship24-shaped delivery event for the number Alice entered, posted with the webhook secret; no parcel moves in a test run.' },
      () => ship24Delivered(trackingNumber),
    );

    await assertState("Bob's 7-day inspection window opens", {
      member: 'buyer',
      db: status,
      ui: (page) => shownSaleStatus(page),
      expect: 'INSPECTION',
      timeout: SETTLE_MS,
    });

    await step('Bob checks the card and completes the purchase', 'buyer', (page) => completePurchase(page));

    await assertState('The sale is complete for Alice', {
      member: 'seller',
      db: status,
      ui: (page) => shownSaleStatus(page),
      expect: 'COMPLETED',
      timeout: SETTLE_MS,
    });

    await simulated(
      "The new-seller holdback passes (7 days from payment)",
      {
        mechanism: 'moved-timestamp',
        reason: 'A new seller is paid 7 days after collection (ESC-03); payment_settled_at and any recorded release time move back 8 days instead of waiting.',
      },
      async () => {
        const row = await saleRow<{ seller_payout_release_at: string | null }>(saleId, 'seller_payout_release_at');
        const columns = ['payment_settled_at', ...(row.seller_payout_release_at ? ['seller_payout_release_at'] : [])];
        await rewind('cash_sales', saleId, columns, 8 * DAY_MS);
      },
    );

    await arrange('The hourly payout job runs (called on demand, as Vercel Cron would)', async () => {
      // Driven until it settles, not a fixed number of passes. In a parallel run other
      // workers' drains claim this row, and Stripe test mode rate-limits, so a pass can
      // find the row in flight and leave it PENDING; the next pass picks it up.
      const until = Date.now() + 90_000;
      while (Date.now() < until) {
        await runJobOk('cash-sale-payouts');
        const row = await saleRow<{ seller_payout_status: string }>(saleId, 'seller_payout_status');
        if (row.seller_payout_status !== 'PENDING') break;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    });

    await assertState('Alice is paid: the transfer is sent to her payout account', {
      member: 'seller',
      db: () => saleRow<{ seller_payout_status: string }>(saleId, 'seller_payout_status').then((row) => row.seller_payout_status),
      ui: (page) => shownSellerPayout(page),
      expect: 'SETTLED',
      timeout: SETTLE_MS,
    });

    await step('Bob sees his finished purchase', 'buyer', async (page) => {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.poll(() => shownSaleStatus(page), { timeout: RENDERED }).toBe('COMPLETED');
      await beat(page);
    });
  },
);

pathway(
  {
    id: 'journeys.trade-lifecycle',
    title: 'Trade start to finish: propose, agree, collateral, handover, accept, holds voided',
    area: 'journeys',
    kind: 'happy',
    provider: 'stripe',
    members: { proposer: CAROL, counterpart: DAVE },
    viewports: 'both',
    timeout: LIFECYCLE_TIMEOUT_MS,
    knownFindings: ['F73', 'F74', 'F76'],
  },
  async ({ step, arrange, assertState }) => {
    const carolTitle = marked(`Journey trade offer ${journeyNonce()}`);
    const daveTitle = marked(`Journey trade wanted ${journeyNonce()}`);
    let daveItemId = '';
    let tradeId = '';
    const state = () => tradeRow<{ state: string }>(tradeId, 'state').then((row) => row.state);

    await step('Dave lists a card worth A$120.00', 'counterpart', async (page) => {
      daveItemId = itemIdFromUrl(await createListing(page, { title: daveTitle, priceDollars: '120.00', description: 'Listed by the trade journey.' }));
      await beat(page);
    });

    await step('Carol lists a card of equal value to offer', 'proposer', async (page) => {
      await createListing(page, { title: carolTitle, priceDollars: '120.00', description: 'Offered by the trade journey.' });
      await beat(page);
    });

    await step("Carol proposes a swap from Dave's listing", 'proposer', async (page) => {
      await page.goto(`/listings/${daveItemId}`);
      await page.waitForLoadState('domcontentloaded');
      await beat(page);
      await proposeSwap(page, carolTitle);
      await expect
        .poll(() => tradeIdFor(CAROL.id, daveItemId), { message: 'the trade row exists', timeout: RENDERED })
        .not.toBeNull();
      tradeId = (await tradeIdFor(CAROL.id, daveItemId)) as string;
      // Sending lands in the new room; when a list redirect wins the race, go to it.
      if (!page.url().endsWith(`/trades/${tradeId}`)) {
        await page.goto(`/trades/${tradeId}`);
        await page.waitForLoadState('domcontentloaded');
      }
      await beat(page);
    });

    await step('Carol sets where and when they meet', 'proposer', (page) => setMeetingTerms(page));

    await step('Dave opens the offer', 'counterpart', async (page) => {
      await page.goto(`/trades/${tradeId}`);
      await page.waitForLoadState('domcontentloaded');
      await beat(page);
    });

    await assertState('Both are negotiating the same terms', {
      member: 'counterpart',
      db: state,
      ui: (page) => shownTradeState(page),
      expect: 'NEGOTIATING',
    });

    await step(
      'Dave reads what accepting costs: no fee, trade collateral as a temporary card hold',
      'counterpart',
      async (page) => {
        await reviewTradeAcceptance(page);
      },
      { copy: { collateral: true } },
    );

    await step('Dave accepts the terms', 'counterpart', (page) => confirmTradeAcceptance(page));

    // No second accept: saving terms IS the saver's acceptance (an edit clears only the
    // OTHER trader's, ESC-04), so Carol accepted the version she saved and Dave's accept
    // agrees it. The room then says "Both traders agreed the same terms".
    await assertState('The terms are agreed and both cards wait for their hold', {
      member: 'proposer',
      db: state,
      ui: (page) => shownTradeState(page),
      expect: 'COLLATERAL_PENDING',
      timeout: SETTLE_MS,
    });

    await arrange(
      'The hourly trade job places the holds a day before the meeting (called on demand, as Vercel Cron would)',
      () => runJobOk('trade-inspections'),
    );

    await assertState('Collateral locks, and Dave sees it live', {
      member: 'counterpart',
      db: state,
      ui: (page) => shownTradeState(page),
      expect: 'COLLATERAL_LOCKED',
      timeout: SETTLE_MS,
    });

    await assertState('Each card carries a live temporary hold in Stripe', {
      member: 'proposer',
      db: () => holdStatusesInStripe(tradeId),
      ui: (page) => shownHoldStatuses(page),
      expect: ['ACTIVE', 'ACTIVE'],
      timeout: SETTLE_MS,
    });

    await step('They meet; Carol confirms the handover', 'proposer', (page) => confirmTradeHandover(page));

    await step('Dave confirms the handover', 'counterpart', (page) => confirmTradeHandover(page));

    await assertState('The 72-hour inspection window opens', {
      member: 'counterpart',
      db: state,
      ui: (page) => shownTradeState(page),
      expect: 'INSPECTION',
      timeout: SETTLE_MS,
    });

    await step('Carol accepts the card she received', 'proposer', (page) => acceptTradeItem(page));

    await step('Dave accepts the card he received', 'counterpart', (page) => acceptTradeItem(page));

    await assertState('The trade completes for both', {
      member: 'proposer',
      db: state,
      ui: (page) => shownTradeState(page),
      expect: 'COMPLETED',
      timeout: SETTLE_MS,
    });

    await assertState('Both holds are released: voided in Stripe, nothing charged', {
      member: 'counterpart',
      db: () => holdStatusesInStripe(tradeId),
      ui: (page) => shownHoldStatuses(page),
      expect: ['VOIDED', 'VOIDED'],
      timeout: SETTLE_MS,
    });
  },
);

// ─── Everyday pathways (unmigrated) ──────────────────────────────────────────

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

/**
 * Creates the everyday pathways' two listings once per worker, from the `beforeAll`
 * of the groups that read them. Not a file-level hook: that would also run before
 * the lifecycle Pathways above, which create their own listings.
 */
async function ensureLegacyListings(browser: Browser): Promise<void> {
  if (subject && control) return;
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
}

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

  test.beforeAll(async ({ browser }) => {
    await ensureLegacyListings(browser);
  });

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
    await ensureLegacyListings(browser);
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
      .getByRole('button', { name: /^Save item\b/ })
      .filter({ visible: true })
      .first();
    const unsave = page
      .getByRole('button', { name: /^Remove from saved items\b/ })
      .filter({ visible: true })
      .first();

    // Idempotent start: a re-run against a surviving watchlist row starts saved.
    if (await unsave.count()) {
      await clickForWrite(unsave, `/listings/${subject.itemId}`);
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
      .getByRole('button', { name: /^Remove from saved items\b/ })
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
      page.getByRole('link', { name: /^Edit( listing)?$/ }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'owner listing detail');

    await page.goto('/listings/mine');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: RENDERED });

    // Editing is reachable and pre-filled with this listing, not an empty form.
    await page.goto(`/listings/${itemId}/edit`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
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

  test('the bottom hub bar reaches references, selling, account and contracts', async ({ page }) => {
    test.skip(!isPhone(page), 'the hub bar is phone-only');

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const nav = page.getByRole('navigation', { name: 'Marketplace hubs' });
    await expect(nav).toBeVisible({ timeout: RENDERED });

    // References is the second hub, and the bar stays under its page. That page sits
    // outside the workspace group, which is where the bar used to stop.
    await nav.getByRole('link', { name: /References/i }).click();
    await expect(page).toHaveURL(/\/references$/, { timeout: COLD_ROUTE });
    await expect(
      page.getByRole('heading', { name: /References, all in one place/i }),
    ).toBeVisible({ timeout: RENDERED });
    await expect(nav.getByRole('link', { name: /References/i })).toHaveAttribute('aria-current', 'page');

    // Sell opens the focused listing form (/listings/new intentionally hides the hub bar).
    await nav.getByRole('link', { name: /Sell/i }).click();
    await expect(page).toHaveURL(/\/listings\/new/, { timeout: COLD_ROUTE });
    await page.getByRole('link', { name: 'Back to marketplace' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: COLD_ROUTE });
    await expect(nav).toBeVisible({ timeout: RENDERED });

    // Account is one tap, marks itself current, and lists the contract inboxes the
    // old Contracts sheet held.
    await nav.getByRole('link', { name: /Account/i }).click();
    await expect(page).toHaveURL(/\/profile/, { timeout: COLD_ROUTE });
    await expect(
      page.getByRole('heading', { name: ALICE.displayName }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expectNothingUnderMobileNav(page, 'profile');

    await page.getByRole('link', { name: 'Purchases', exact: true }).click();
    await expect(page).toHaveURL(/\/purchases/, { timeout: COLD_ROUTE });
    await expect(
      page.getByRole('heading', { name: 'Purchases' }).first(),
    ).toBeVisible({ timeout: RENDERED });
    await expect(nav.getByRole('link', { name: /Account/i })).toHaveAttribute('aria-current', 'page');
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
