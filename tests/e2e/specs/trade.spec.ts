// tests/e2e/specs/trade.spec.ts
//
// 2-Way Trade escrow: proposing a swap, and the lifecycle behind it.
//
// WHAT IS COVERED HERE is the proposal surface — that a non-owner is offered
// Propose Trade, that the dialog exposes the real controls, and that Send Offer is
// GATED until goods are actually named. That last one is the substantive assertion:
// a trade with no items on one side is not a trade, and the gate is what stops one
// being sent.
//
// STRUCTURE READ OFF THE RUNNING DIALOG (tests/e2e/debug/inspect.spec.ts). Two
// things worth knowing before editing:
//   * The dialog's heading is "Offer a trade", not "Propose Trade" — that is the
//     trigger BUTTON's label. They differ.
//   * Its section triggers carry the section name AND its hint as one accessible
//     name: "Your listingsAdd from your listings", "Offer TermsAdd an unlisted
//     item", "Payment TermsOptional". Matched by prefix, never by equality.
//   * Fulfilment is a radio pair whose names likewise run label and hint together:
//     "Face to faceMeet and swap" and "DeliveryPost it".
//
// The item pair is Pair A from seed.sql — Alice's Charizard against Bob's Jordan
// rookie, both $250, deliberately equal because a trade is a swap of equal Fair
// Market Value and an unequal pair would be refused for a different reason than the
// one under test.

import { test, expect } from '@playwright/test';
import { ALICE, BOB, TRADE_PAIR_A, storageStatePath } from '../support/users';
import { RENDERED } from '../support/waiting';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE]);
});

test.describe('Propose a trade', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('a non-owner is offered the trade entry point', async ({ page }) => {
    await page.goto(`/listings/${TRADE_PAIR_A.bobItemId}`);
    await page.waitForLoadState('domcontentloaded');

    // The item title is an h2 — the h1 is the shell's ("Marketplace"). Asserting a
    // level-1 heading contains the item name fails on every listing in the app, and
    // is what the first version of this file did.
    await expect(
      page.getByRole('heading', { name: /Michael Jordan Rookie/ }),
    ).toBeVisible({ timeout: RENDERED });

    await expect(page.getByRole('button', { name: 'Propose Trade' })).toBeVisible();
  });

  test('the dialog exposes its sections and gates Send Offer until goods are named', async ({
    page,
  }) => {
    await page.goto(`/listings/${TRADE_PAIR_A.bobItemId}`);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Propose Trade' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });
    // Trigger says "Propose Trade"; the dialog says "Offer a trade".
    await expect(dialog.getByRole('heading', { name: 'Offer a trade' })).toBeVisible();

    // Section triggers, matched by prefix — each accessible name concatenates the
    // section title with its hint.
    await expect(dialog.getByRole('button', { name: /^Your listings/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Offer Terms/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Payment Terms/ })).toBeVisible();

    // Both fulfilment methods are offered. A trade's two routes to INSPECTION are
    // genuinely different — DELIVERY posts both ways, IN_PERSON converges in one
    // step — so both must be reachable from here.
    await expect(dialog.getByRole('radio', { name: /^Face to face/ })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /^Delivery/ })).toBeVisible();

    // THE SUBSTANTIVE ASSERTION. Nothing has been offered yet, so the proposal
    // cannot be sent: a trade with no goods on one side is not a trade. The control
    // is present and DISABLED rather than hidden, so the requirement is visible
    // before it is hit.
    await expect(dialog.getByRole('button', { name: 'Send Offer' })).toBeDisabled();
  });

  test('the owner is not offered a trade on their own listing', async ({ page }) => {
    // Alice owns the Charizard. `openTradeNegotiation` refuses self-dealing, so
    // surfacing the control would be an invitation to a refusal.
    await page.goto(`/listings/${TRADE_PAIR_A.aliceItemId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: /Charizard/ }),
    ).toBeVisible({ timeout: RENDERED });
    await expect(page.getByRole('button', { name: 'Propose Trade' })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// THE LIFECYCLE IS NOT COVERED, and the reasons are worth stating precisely
// because they are product constraints rather than missing selectors.
//
// NEGOTIATING → COLLATERAL_PENDING → COLLATERAL_LOCKED → IN_TRANSIT → INSPECTION
// → COMPLETED needs all of:
//
//   1. AN ADDRESS PER TRADER, resolved by Google Places. A posted trade keeps a
//      postal address of record for BOTH sides (`trade_delivery_details` — two rows,
//      because a swap posts in both directions), and the suite runs with no Maps key
//      so no resolved place can be produced. Same blocker as F13, doubled. The
//      IN_PERSON route is not a way around it: it needs a resolved meeting place and
//      a future meeting instant.
//   2. A SAVED CARD ON BOTH TRADERS. Collateral is a real authorisation for 100% of
//      FMV against each side, and `acceptTradeTerms` refuses without an instrument.
//      Reachable — `tests/e2e/support/payments.ts` does it — but only after (1).
//   3. FOUR SEPARATE ACTS after collateral locks: both ship, both confirm receipt.
//      Each is a distinct browser context, and the state only advances on the
//      SECOND of each pair, which is the part worth testing and the part that
//      cannot be reached at all today.
//
// So this is not "write more assertions": items 1 and 2 gate everything after
// terms-agreement. Unblocking is the same piece of work as F13 — intercept the
// Places request with `page.route()` and serve a fixed suggestion — after which the
// trade lifecycle and the Cash_Sale lifecycle both become reachable with the
// selectors already recorded in tests/e2e/debug/inspect.spec.ts.
//
// Deliberately NOT left as failing tests or as `fixme` bodies full of guessed
// selectors: a skipped test written against an unverified DOM is a liability, since
// it looks like coverage waiting to be switched on when it is really an untested
// draft. The trade state machine itself is covered by unit and property tests
// (tests/unit/tradeFulfilment.test.ts, tests/unit/tradeProposal.test.ts,
// domain/state-machine), which is where transition logic belongs; what is missing
// here is only the browser-level proof that the UI drives those transitions.
// ---------------------------------------------------------------------------
