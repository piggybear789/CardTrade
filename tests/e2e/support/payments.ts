// tests/e2e/support/payments.ts
//
// Giving a buyer a saved card, and entering a card for real. Opening a Cash_Sale from a
// listing or an offer needs one, and so do paying by card and trade collateral.
//
// TWO CARD FORMS, one per provider (Req 4.3, 4.4, 24.2):
//   * Stripe test mode (the main server): the card fields are Stripe's Payment Element,
//     inside Stripe's own iframe. `enterCardDetails` types a published TEST card number
//     into THAT iframe through `frameLocator`; no card number ever goes into a NoDitto
//     field, request or row. A card that demands 3-D Secure is then finished or failed
//     in Stripe's challenge frame with `completeThreeDSecure` / `failThreeDSecure`.
//   * `PAYMENTS_PROVIDER=mock` (the aux server): the form offers a single "Save demo
//     card" button instead, because there is no Stripe.js to mount. That button is the
//     whole interaction, and `ensureSavedCard` still takes it there.
//
// Seed members are already bound to a saved test card by
// `audit/stripe-bindings.setup.ts`, so on the main server `ensureSavedCard` usually
// finds one and returns. A persona with no card takes the real-entry path.
//
// Prior art for the iframe and the bank redirect: `tests/e2e/stripe/bank-rails.stripe.ts`.

import { expect, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test';

import { ENTRY_CARDS, type EntryCard } from '../audit/stripeFixtures';

/** Stripe's Payment Element iframe (the card, bank and wallet fields). */
export const PAYMENT_ELEMENT_FRAME = 'iframe[title="Secure payment input frame"]';

/** Any expiry in the future works for a Stripe test card; CVC any 3 digits (4 for Amex). */
const TEST_EXPIRY = '12 / 34';
const TEST_POSTCODE = '10001';

/** How long Stripe.js may take to mount its iframe on a cold page. */
const STRIPE_READY = 30_000;
/** How long the 3-D Secure challenge may take to appear after submit. */
const CHALLENGE_READY = 45_000;

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

/** The Payment Element inside `scope` (a page, or the dialog that holds the form). */
export function paymentElement(scope: Page | Locator): FrameLocator {
  return scope.frameLocator(PAYMENT_ELEMENT_FRAME).first();
}

/** The first of several selectors Stripe has used for one field, plus its label. */
function field(frame: FrameLocator, ids: string[], label: RegExp): Locator {
  return frame.locator(ids.join(', ')).or(frame.getByLabel(label)).first();
}

/**
 * Type a Stripe TEST card into the Payment Element inside `scope`.
 *
 * Selects the Card tab when the element offers several methods, then fills number,
 * expiry and CVC, and the name and postcode fields when Stripe shows them (it decides
 * per country). Does not submit.
 */
export async function enterCardDetails(
  scope: Page | Locator,
  card: EntryCard = ENTRY_CARDS.success,
  options: { name?: string } = {},
): Promise<void> {
  const frame = paymentElement(scope);
  const number = field(frame, ['#payment-numberInput', '#Field-numberInput'], /card number/i);

  // With several methods enabled the element opens on a tab row; card may not be first.
  const cardTab = frame.getByRole('tab', { name: /^card$/i }).or(frame.locator('[data-value="card"]')).first();
  await expect(number.or(cardTab).first()).toBeVisible({ timeout: STRIPE_READY });
  if (!(await number.isVisible().catch(() => false)) && (await cardTab.isVisible().catch(() => false))) {
    await cardTab.click();
  }
  await expect(number).toBeVisible({ timeout: STRIPE_READY });

  await number.fill(card.number);
  await field(frame, ['#payment-expiryInput', '#Field-expiryInput'], /expir/i).fill(TEST_EXPIRY);
  const cvc = card.number.startsWith('34') || card.number.startsWith('37') ? '1234' : '123';
  await field(frame, ['#payment-cvcInput', '#Field-cvcInput'], /security code|cvc/i).fill(cvc);

  const name = frame.locator('#payment-nameInput, #Field-nameInput').first();
  if (await name.isVisible().catch(() => false)) await name.fill(options.name ?? 'E2E Test Buyer');
  const postcode = frame.locator('#payment-postalCodeInput, #Field-postalCodeInput').first();
  if (await postcode.isVisible().catch(() => false)) await postcode.fill(TEST_POSTCODE);
}

/** What a 3-D Secure challenge should end in. */
export type ChallengeOutcome = 'complete' | 'fail';

/**
 * Save `card` through the add-card form inside `scope` (the "Add a payment method"
 * dialog, or the profile's card section): enter it in Payment Element, press Save card,
 * and finish or fail the 3-D Secure challenge when the card demands one.
 *
 * Asserts nothing about the outcome; the caller checks the saved label or the error.
 */
export async function saveCardInPaymentElement(
  page: Page,
  scope: Locator,
  card: EntryCard = ENTRY_CARDS.success,
  outcome: ChallengeOutcome = 'complete',
): Promise<void> {
  await enterCardDetails(scope, card);
  await scope.getByRole('button', { name: /^Save card$/ }).click();
  if (card.challenges) {
    await (outcome === 'complete' ? completeThreeDSecure(page) : failThreeDSecure(page));
  }
}

/** The "Complete" and "Fail" controls on Stripe's test 3-D Secure page. */
function challengeButton(frame: Frame, outcome: ChallengeOutcome): Locator {
  return outcome === 'complete'
    ? frame
        .locator('#test-source-authorize-3ds')
        .or(frame.getByRole('button', { name: /^complete( authentication)?$/i }))
        .first()
    : frame
        .locator('#test-source-fail-3ds')
        .or(frame.getByRole('button', { name: /^fail( authentication)?$/i }))
        .first();
}

/**
 * The frame holding Stripe's test 3-D Secure challenge.
 *
 * Stripe nests the challenge two or three iframes deep (an overlay frame, the
 * `#challengeFrame`, sometimes an `acsFrame`), and the depth has changed between
 * Stripe.js releases. So this scans every frame on the page for the challenge's own
 * buttons rather than hard-coding a `frameLocator` chain that a Stripe release breaks.
 */
async function challengeFrame(page: Page, outcome: ChallengeOutcome): Promise<Frame> {
  let found = null as Frame | null;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          if (await challengeButton(frame, outcome).isVisible().catch(() => false)) {
            found = frame;
            return true;
          }
        }
        return false;
      },
      { message: 'the Stripe 3-D Secure challenge appears', timeout: CHALLENGE_READY, intervals: [250, 500, 1_000] },
    )
    .toBe(true);
  return found!;
}

async function answerChallenge(page: Page, outcome: ChallengeOutcome): Promise<void> {
  const frame = await challengeFrame(page, outcome);
  const closed = async () => frame.isDetached() || !(await challengeButton(frame, outcome).isVisible().catch(() => false));
  // The challenge closes itself once Stripe has the answer; wait for that so the caller
  // reads the page Stripe.js returned to, not the overlay. A click that lands while
  // Stripe's test page is still wiring its buttons is dropped (seen once in a full
  // area run: the button stayed for 45 s), so an unanswered challenge is clicked again,
  // at most twice more.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await challengeButton(frame, outcome).click({ timeout: 10_000 }).catch(() => undefined);
    const done = await expect
      .poll(closed, { timeout: attempt < 3 ? 15_000 : CHALLENGE_READY })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (done) return;
  }
  expect(await closed(), 'the Stripe 3-D Secure challenge closes').toBe(true);
}

/** Pass Stripe's test 3-D Secure challenge (saving a card, or paying in the room). */
export async function completeThreeDSecure(page: Page): Promise<void> {
  await answerChallenge(page, 'complete');
}

/** Fail Stripe's test 3-D Secure challenge. Nothing is charged; the caller checks the room. */
export async function failThreeDSecure(page: Page): Promise<void> {
  await answerChallenge(page, 'fail');
}

/**
 * Ensure the signed-in member has a saved payment method, using the Buy dialog on
 * any listing they do not own as the entry point.
 *
 * Idempotent: if a card is already attached the checkout shows it and this returns
 * without saving a second one. Otherwise it saves `options.card` through Stripe's
 * Payment Element on a Stripe server, or the demo card on the mock server.
 *
 * @param page   a page authenticated as the BUYER
 * @param itemId any listing the buyer does not own
 */
export async function ensureSavedCard(
  page: Page,
  itemId: string,
  options: { card?: EntryCard } = {},
): Promise<void> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const dialog = await openBuyCheckout(page);
  const addCard = dialog.getByRole('button', { name: 'Add a card to continue' });
  if (await addCard.isVisible().catch(() => false)) {
    await addCard.click();
    await expect(dialog.getByRole('heading', { name: 'Add a payment method' })).toBeVisible({
      timeout: 20_000,
    });

    const demo = dialog.getByRole('button', { name: /Save demo card/i });
    const stripeFrame = dialog.locator(PAYMENT_ELEMENT_FRAME).first();
    await expect(demo.or(stripeFrame).first()).toBeVisible({ timeout: STRIPE_READY });
    if (await demo.isVisible().catch(() => false)) {
      await demo.click();
    } else {
      await saveCardInPaymentElement(page, dialog, options.card ?? ENTRY_CARDS.success);
    }
    // On success the dialog re-reads the card and returns to the checkout, now showing it.
    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible({ timeout: 25_000 });
  }

  // Leave the dialog closed so the caller starts from a clean page.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}
