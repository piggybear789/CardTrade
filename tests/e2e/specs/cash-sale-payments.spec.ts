// tests/e2e/specs/cash-sale-payments.spec.ts
//
// THE PAY STEP OF A CASH SALE against REAL Stripe test mode on the main server (task
// 9.2): every way a buyer pays, and every refusal the Pay step or Buy Now can give.
// The lifecycle around it (terms, shipping, inspection, payout) is `cash-sale.spec.ts`.
//
//   cash-sale.payments.card-no-auth         card, no authentication; fee label and total = charged (13.5, 31.3)
//   cash-sale.payments.card-3ds             card with a 3-D Secure challenge passed (13.6)
//   cash-sale.payments.card-3ds-failed      the challenge failed; nothing charged (13.6)
//   cash-sale.payments.card-declined        a card declined at Pay; nothing charged (13.7)
//   cash-sale.payments.bank-payto           PayTo, approved in place, AUD (13.8)
//   cash-sale.payments.bank-ideal           iDEAL, bank redirect, EUR on behalf of a German seller (13.8)
//   cash-sale.payments.bank-bancontact      Bancontact, same shape (13.8)
//   cash-sale.payments.bank-eps             EPS, same shape (13.8)
//   cash-sale.payments.bank-p24             Przelewy24, same shape (13.8)
//   cash-sale.payments.card-repriced        CARD_REPRICED, sale untouched (13.9)
//   cash-sale.payments.buyer-identity-required  over the unverified-buyer limit (13.10)
//   cash-sale.payments.seller-not-payable   SELLER_NOT_PAYABLE on a cross-border sale (13.11)
//   cash-sale.payments.related-accounts     RELATED_ACCOUNTS on a shared card, no reason shown (13.19)
//   cash-sale.payments.seller-exposure-limit  SELLER_EXPOSURE_LIMIT for a new seller (13.20)
//   cash-sale.payments.region-mismatch      REGION_MISMATCH at Buy Now (13.21)
//
// The bank-rail Pathways are `tests/e2e/stripe/bank-rails.stripe.ts` moved onto the DSL
// and widened from two rails to all five offered. Its patch-and-restore of Uma and
// Victor is gone: the buyer and the German seller are Personas.
//
// NO SIMULATED STEPS. Every payment, challenge, decline and bank approval here is
// Stripe test mode driven through the real room; no webhook reaches localhost, so the
// room's read-back (`confirmCashSalePayment`) is what settles, which is the reliable
// path by design. What a member could not click to (a listing insert, a seller's
// payout state, the German fixture account) is an `arrange` step.
//
// REFUSAL CODES are read from the Server Action response (`captureActionRefusal`),
// because the room and the Buy dialog show copy only.

import type { Page } from '@playwright/test';

import { pathway, type PathwayContext } from '../audit/pathway';
import { ENTRY_CARDS } from '../audit/stripeFixtures';
import { testStripe } from '../audit/backend/stripe';
import { expect } from '../support/fixtures';
import { marked } from '../support/marker';
import { completeThreeDSecure, failThreeDSecure, openBuyCheckout, saveCardInPaymentElement } from '../support/payments';
import { STUB_PLACES, type StubbedPlace } from '../support/places';
import { ALICE, UMA_US_SELLER, persona } from '../support/users';
import { RENDERED } from '../support/waiting';
import { closeDetailsSheetIfOpen, openSection } from '../support/cashSaleRoom';
import {
  amountReceived,
  arrangeSellerPersona,
  authoriseAtTestBank,
  buyNow,
  captureActionRefusal,
  cardConfirm,
  challengeAppears,
  chooseRail,
  continueToRail,
  expectedCharge,
  fillBankDetails,
  itemStatus,
  openPayDialog,
  payButton,
  payDialog,
  proposeDelivery,
  reserve,
  saleIntent,
  saleRow,
  saleStatus,
  saveCardFromProfile,
  searchCatalogFor,
  seedListing,
  shownCardTotal,
  takeDeFixtureAccount,
  visibleInCatalog,
  visibleListingBuyable,
  visibleSaleStatus,
} from '../support/cashSalePayments';
import { CASH_SALE_ERROR_MESSAGES } from '../../../components/sales/errorCopy';
import { cardMethodFor, type PaymentMethodKind } from '../../../domain/payments/paymentMethods';
import { regionMismatchMessage } from '../../../domain/region/regions';
import { formatMoney } from '../../../lib/format';

/** Long enough for Stripe.js, a challenge and the read-back on a cold room. */
const PAY_TIMEOUT = 300_000;
/** The EU rails also wait their turn for the one German fixture account. */
const EU_RAIL_TIMEOUT = 720_000;
/** How long the room may take to show a settled payment after Pay. */
const HELD_TIMEOUT = 90_000;

/** The figure in the room header's "<total> total", e.g. "$154.35 AUD". */
async function visibleHeaderTotal(page: Page): Promise<string> {
  const node = page.getByText(/^.+ [A-Z]{3} total$/).filter({ visible: true }).first();
  if (!(await node.isVisible().catch(() => false))) {
    const details = page.getByRole('button', { name: 'Contract details' }).filter({ visible: true }).first();
    if (await details.isVisible().catch(() => false)) {
      await details.click();
    }
  }
  const text = await node.textContent({ timeout: 2_000 }).catch(() => null);
  await closeDetailsSheetIfOpen(page);
  return text ? text.replace(/\s+/g, ' ').trim().replace(/ total$/, '') : 'none';
}

/** Words that would tell a member WHY two accounts are related (Req 13.19). */
const RELATED_REASON = /related|linked|same card|share|shared|another account|fingerprint|duplicate/i;

// ═══ Card ═════════════════════════════════════════════════════════════════════════

pathway(
  {
    id: 'cash-sale.payments.card-no-auth',
    title: 'Buyer pays a cash sale by card with no authentication, charged exactly the total shown',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    // A US buyer on the US platform: their card is domestic there, and this Amex is
    // Stripe's test card for "3-D Secure not supported", so a new buyer (whom
    // `decideThreeDS` always asks to authenticate) is still not challenged.
    members: { buyer: persona('card-buyer', { regionCode: 'US', savedCard: true }), seller: UMA_US_SELLER },
    personaOptions: { buyer: { card: 'pm_card_amex_threeDSecureNotSupported' } },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    const itemId = await arrange('Uma lists a card at US$150.00', () =>
      seedListing(UMA_US_SELLER.id, { title: marked(`Pay card ${Date.now()}`), priceMinor: 15_000, place: STUB_PLACES.portland }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page, STUB_PLACES.portland));

    let shown = '';
    await step(
      'Buyer opens Pay and sees the buyer protection fee rate and the total',
      'buyer',
      async (page) => {
        const dialog = await openPayDialog(page);
        shown = await shownCardTotal(dialog);
        expect(shown, 'the total shown is the card total the fee tables give').toBe(
          expectedCharge(await saleRow(saleId), 'CARD').total,
        );
      },
      { copy: { fee: { currency: 'USD', method: 'CARD' } } },
    );

    await step('Buyer pays, with no challenge', 'buyer', async (page) => {
      await cardConfirm(payDialog(page)).click();
      expect(await challengeAppears(page, 8_000), 'no 3-D Secure challenge for this card').toBe(false);
    });

    await assertState('The payment is held by the platform', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'ESCROW_HELD',
      timeout: HELD_TIMEOUT,
    });
    await assertState('The charged amount_cents is the total that was shown', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return formatMoney(row.amount_cents, row.currency);
      },
      ui: visibleHeaderTotal,
      expect: shown,
    });
    await assertState('Stripe received exactly that total', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return formatMoney(await amountReceived(row), row.currency);
      },
      ui: visibleHeaderTotal,
      expect: shown,
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.card-3ds',
    title: 'Buyer pays a cash sale by card and passes the 3-D Secure challenge',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    // No saved card: the buyer types Stripe's "3-D Secure on every use" test card into
    // Payment Element at Buy Now, authenticating the setup, then again at Pay.
    members: { buyer: persona('threeds-buyer', { regionCode: 'AU' }), seller: ALICE },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    // 4000 0000 0000 3220 is US-issued, so on the AU platform it is priced as an
    // international card (0159).
    const method = cardMethodFor('aud', 'US');
    const itemId = await arrange('Alice lists a card at A$150.00', () =>
      seedListing(ALICE.id, { title: marked(`Pay 3DS ${Date.now()}`), priceMinor: 15_000 }),
    );
    const saleId = await step('Buyer adds a 3-D Secure card at Buy Now and reserves', 'buyer', (page) =>
      buyNow(page, itemId, ENTRY_CARDS.threeDSecure),
    );
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));

    let shown = '';
    await step(
      'Buyer opens Pay and sees the fee for their card',
      'buyer',
      async (page) => {
        const dialog = await openPayDialog(page);
        shown = await shownCardTotal(dialog);
        expect(shown).toBe(expectedCharge(await saleRow(saleId), method).total);
      },
      { copy: { fee: { currency: 'AUD', method } } },
    );
    await step('Buyer pays and completes the 3-D Secure challenge', 'buyer', async (page) => {
      await cardConfirm(payDialog(page)).click();
      await completeThreeDSecure(page);
    });

    await assertState('The payment is held by the platform', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'ESCROW_HELD',
      timeout: HELD_TIMEOUT,
    });
    await assertState('Stripe received exactly the total shown', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return formatMoney(await amountReceived(row), row.currency);
      },
      ui: visibleHeaderTotal,
      expect: shown,
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.card-3ds-failed',
    title: 'Buyer fails the 3-D Secure challenge at Pay and nothing is charged',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      buyer: persona('threeds-fail-buyer', { regionCode: 'AU' }),
      seller: ALICE,
      viewer: persona('threeds-fail-viewer', { regionCode: 'AU' }),
    },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal }) => {
    const title = marked(`Pay 3DS fail ${Date.now()}`);
    const itemId = await arrange('Alice lists a card at A$150.00', () =>
      seedListing(ALICE.id, { title, priceMinor: 15_000 }),
    );
    const saleId = await step('Buyer adds a 3-D Secure card at Buy Now and reserves', 'buyer', (page) =>
      buyNow(page, itemId, ENTRY_CARDS.threeDSecure),
    );
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));
    await step('Buyer opens Pay', 'buyer', async (page) => {
      await shownCardTotal(await openPayDialog(page));
    });

    await refusal(
      'Buyer fails the challenge and is told the payment was not collected',
      'buyer',
      (page) =>
        captureActionRefusal(page, async () => {
          await cardConfirm(payDialog(page)).click();
          await failThreeDSecure(page);
        }),
      // Code only, as in card-declined: the toast is transient (FINDINGS F90).
      { code: 'TRANSFER_FAILED' },
    );
    await step('The room shows the payment as failed', 'buyer', async (page) => {
      // The progress line names the halted step on its own (Failed), 2026-11-27.
  await expect(page.getByText(/^Failed$|· Failed$/).filter({ visible: true }).first()).toBeVisible({ timeout: RENDERED });
    });

    // A failed card collection ends the sale (FAILED) and relists the item, the owner's
    // decision (Req 13.6): nothing was taken, and another member can buy the item.
    await assertState('The sale is FAILED', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'FAILED',
    });
    await assertState('Nothing was charged', {
      member: 'buyer',
      db: async () => amountReceived(await saleRow(saleId)),
      ui: async (page) => ((await visibleSaleStatus(page)) === 'FAILED' ? 0 : -1),
      expect: 0,
    });
    await step('Buyer opens the listing again', 'buyer', async (page) => {
      await page.goto(`/listings/${itemId}`);
      await page.waitForLoadState('domcontentloaded');
    });
    await assertState('The item is AVAILABLE again', {
      member: 'buyer',
      db: () => itemStatus(itemId),
      ui: visibleListingBuyable,
      expect: 'AVAILABLE',
    });
    await step('Another member searches the catalog for the item', 'viewer', (page) => searchCatalogFor(page, title));
    await assertState('The relisted item is visible in the catalog to another member', {
      member: 'viewer',
      db: () => itemStatus(itemId),
      ui: (page) => visibleInCatalog(page, itemId),
      expect: 'AVAILABLE',
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.card-declined',
    title: 'Buyer is declined at Pay and nothing is charged',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    // 4000 0000 0000 0341 saves, then every charge on it is declined.
    members: {
      buyer: persona('declined-buyer', { regionCode: 'AU' }),
      seller: ALICE,
      viewer: persona('declined-viewer', { regionCode: 'AU' }),
    },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal, viewport }) => {
    const title = marked(`Pay declined ${Date.now()}`);
    const itemId = await arrange('Alice lists a card at A$150.00', () =>
      seedListing(ALICE.id, { title, priceMinor: 15_000 }),
    );
    const saleId = await step('Buyer adds a card at Buy Now and reserves', 'buyer', (page) =>
      buyNow(page, itemId, ENTRY_CARDS.declinesOnCharge),
    );
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));
    await step('Buyer opens Pay', 'buyer', async (page) => {
      await shownCardTotal(await openPayDialog(page));
    });

    await refusal(
      'Buyer pays and the card is declined',
      'buyer',
      (page) =>
        captureActionRefusal(page, async () => {
          await cardConfirm(payDialog(page)).click();
          // A new buyer is always asked to authenticate (`decideThreeDS`); whether the
          // issuer challenges before declining depends on the test card. The decline
          // is what this Pathway asserts.
          if (await challengeAppears(page)) await completeThreeDSecure(page);
        }),
      // The server's code is the refusal. The transfer-failed toast is not asserted: no
      // toast was on screen when the response arrived (FINDINGS F90). The room's closing
      // card carries the member's message instead, asserted below.
      { code: 'TRANSFER_FAILED' },
    );
    // The room's closing card says where the sale stopped and why (the halted step in
    // domain/contract/cashSaleSteps.ts). The heading shows on both viewports; the
    // sentence is desktop-only in the dock (ContractActionCard).
    await step('The room says the payment failed and the item went back', 'buyer', async (page) => {
      await expect(
        page.getByRole('heading', { name: 'Payment failed here' }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: RENDERED });
      if (viewport === 'desktop') {
        await expect(
          page
            .getByText('The payment could not be collected, so the item returned to the catalog.')
            .filter({ visible: true })
            .first(),
        ).toBeVisible({ timeout: RENDERED });
      }
    });

    await assertState('The sale is FAILED', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'FAILED',
    });
    await assertState('Nothing was charged', {
      member: 'buyer',
      db: async () => amountReceived(await saleRow(saleId)),
      ui: async (page) => ((await visibleSaleStatus(page)) === 'FAILED' ? 0 : -1),
      expect: 0,
    });
    await step('Buyer opens the listing again', 'buyer', async (page) => {
      await page.goto(`/listings/${itemId}`);
      await page.waitForLoadState('domcontentloaded');
    });
    await assertState('The item is AVAILABLE again', {
      member: 'buyer',
      db: () => itemStatus(itemId),
      ui: visibleListingBuyable,
      expect: 'AVAILABLE',
    });
    await step('Another member searches the catalog for the item', 'viewer', (page) => searchCatalogFor(page, title));
    await assertState('The relisted item is visible in the catalog to another member', {
      member: 'viewer',
      db: () => itemStatus(itemId),
      ui: (page) => visibleInCatalog(page, itemId),
      expect: 'AVAILABLE',
    });
  },
);

// ═══ Bank rails ═══════════════════════════════════════════════════════════════════

pathway(
  {
    id: 'cash-sale.payments.bank-payto',
    title: 'Buyer pays a cash sale with PayTo, approved in place',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: persona('payto-buyer', { regionCode: 'AU', savedCard: true }), seller: ALICE },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    const itemId = await arrange('Alice lists a card at A$150.00', () =>
      seedListing(ALICE.id, { title: marked(`Pay PayTo ${Date.now()}`), priceMinor: 15_000 }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));

    let expected = { total: '', fee: '', totalMinor: 0, feeMinor: 0 };
    await step(
      'Buyer sees card and PayTo each priced, and chooses PayTo',
      'buyer',
      async (page) => {
        expected = expectedCharge(await saleRow(saleId), 'PAYTO');
        const dialog = await openPayDialog(page);
        await expect(dialog.getByRole('radio', { name: /^Card/ })).toBeChecked();
        await expect(dialog.getByRole('radio', { name: /^PayTo/ })).toBeVisible();
        // Chosen but not continued, so the fee copy is read from this dialog.
        await chooseRail(dialog, /^PayTo/, { proceed: false });
      },
      { copy: { fee: { currency: 'AUD', method: 'PAYTO' } } },
    );

    await step('Buyer approves the amount with PayTo', 'buyer', async (page) => {
      await continueToRail(payDialog(page));
      const bank = page.getByRole('dialog', { name: 'Pay with PayTo' });
      await expect(bank).toBeVisible({ timeout: 30_000 });
      await expect(bank.getByText(`Approve ${expected.total} in your bank, including the ${expected.fee} buyer protection fee`, { exact: false })).toBeVisible();
      await fillBankDetails(page, { name: 'E2E PayTo Buyer', payto: true });
      await bank.getByRole('button', { name: `Pay ${expected.total} with PayTo` }).click();
    });

    await assertState('The payment is held by the platform', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'ESCROW_HELD',
      timeout: HELD_TIMEOUT,
    });
    await assertState('The sale is priced and charged for PayTo', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        const intent = await saleIntent(row);
        const charge = intent.latest_charge as { payment_method_details?: { type?: string } } | null;
        return {
          total: formatMoney(row.amount_cents, row.currency),
          received: formatMoney(intent.amount_received, row.currency),
          kind: row.payment_method_kind,
          rail: charge?.payment_method_details?.type ?? null,
        };
      },
      ui: async (page) => {
        const total = await visibleHeaderTotal(page);
        return { total, received: total, kind: 'PAYTO', rail: 'payto' };
      },
      expect: { total: expected.total, received: expected.total, kind: 'PAYTO', rail: 'payto' },
    });
    await step('Buyer reads how it was paid on the Payment tab', 'buyer', async (page) => {
      await openSection(page, 'Payment');
      await expect(page.getByText(/Buyer paid by PayTo, in AUD/).first()).toBeVisible({ timeout: RENDERED });
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.bank-transfer',
    title: 'Buyer pays a US cash sale by bank transfer, and it settles when the money arrives',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: persona('transfer-buyer', { regionCode: 'US', savedCard: true }), seller: UMA_US_SELLER },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    const itemId = await arrange('Uma lists a card at US$150.00', () =>
      seedListing(UMA_US_SELLER.id, { title: marked(`Pay transfer ${Date.now()}`), priceMinor: 15_000, place: STUB_PLACES.portland }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page, STUB_PLACES.portland));

    let expected = { total: '', fee: '', totalMinor: 0, feeMinor: 0 };
    await step(
      'Buyer sees card and bank transfer each priced, and chooses bank transfer',
      'buyer',
      async (page) => {
        expected = expectedCharge(await saleRow(saleId), 'BANK_TRANSFER');
        const dialog = await openPayDialog(page);
        await expect(dialog.getByRole('radio', { name: /^Card/ })).toBeChecked();
        await expect(dialog.getByRole('radio', { name: /^Bank transfer/ })).toBeVisible();
        await chooseRail(dialog, /^Bank transfer/, { proceed: false });
      },
      { copy: { fee: { currency: 'USD', method: 'BANK_TRANSFER' } } },
    );

    await step('Buyer is shown where to send it, with a reference', 'buyer', async (page) => {
      await continueToRail(payDialog(page));
      const transfer = page.getByRole('dialog', { name: 'Send a bank transfer' });
      await expect(transfer).toBeVisible({ timeout: 30_000 });
      await expect(transfer.getByText(`Send ${expected.total} from your bank`, { exact: false })).toBeVisible();
      await expect(transfer.getByText('Routing number')).toBeVisible();
      await expect(transfer.getByText('Account number')).toBeVisible();
      await expect(transfer.getByText(/^Reference/)).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await assertState('The sale waits for the transfer, and the card stays reserved', {
      member: 'buyer',
      db: async () => ({ sale: await saleStatus(saleId), item: await itemStatus(itemId) }),
      ui: async (page) => ({ sale: await visibleSaleStatus(page), item: 'RESERVED' }),
      expect: { sale: 'PAYMENT_PENDING', item: 'RESERVED' },
    });

    await arrange("The buyer's bank transfer arrives (Stripe's test helper sends it)", async () => {
      const intent = await saleIntent(await saleRow(saleId));
      const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      const reference = intent.next_action?.display_bank_transfer_instructions?.reference ?? undefined;
      if (!customer) throw new Error('the bank transfer has no Customer');
      await testStripe('US').testHelpers.customers.fundCashBalance(customer, {
        amount: intent.amount,
        currency: 'usd',
        ...(reference ? { reference } : {}),
      });
    });

    // Stripe's webhook settles it; the room updates over Realtime. A reload only makes
    // sure this tab shows the settled sale. (Re-opening the transfer details here left a
    // phone sheet over the header the next check reads.)
    await step('Buyer opens the sale again once the money has arrived', 'buyer', async (page) => {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await closeDetailsSheetIfOpen(page);
    });

    await assertState('The payment is held by the platform', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'ESCROW_HELD',
      timeout: HELD_TIMEOUT,
    });
    await assertState('The sale is priced and charged as a bank transfer', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        const intent = await saleIntent(row);
        return {
          total: formatMoney(row.amount_cents, row.currency),
          received: formatMoney(intent.amount_received, row.currency),
          kind: row.payment_method_kind,
          rail: intent.payment_method_types[0] ?? null,
        };
      },
      ui: async (page) => {
        const total = await visibleHeaderTotal(page);
        return { total, received: total, kind: 'BANK_TRANSFER', rail: 'customer_balance' };
      },
      expect: { total: expected.total, received: expected.total, kind: 'BANK_TRANSFER', rail: 'customer_balance' },
    });
  },
);

/** One EU redirect rail, charged on behalf of a German seller. */
interface EuRail {
  kind: PaymentMethodKind;
  /** The Pay dialog's radio, by its label (`paymentMethodDefinition(kind).label`). */
  radio: RegExp;
  /** That label, as the bank dialog's title and submit button spell it. */
  label: string;
  /** Stripe's `payment_method_details.type`. */
  stripeType: string;
  /** Where the buyer is getting it delivered. */
  deliverTo: StubbedPlace;
}

/**
 * The body every EU rail shares (the `pathway({ id })` literals stay inline, so the
 * Coverage_Map can find them). A German seller Persona takes the DE test connected
 * account for the run; a Persona buyer in the rail's country pays EUR 150.00 through
 * the bank's test page and comes back to `/sales/<id>?payment=return`.
 */
async function euRail(ctx: PathwayContext<'buyer' | 'seller'>, rail: EuRail): Promise<void> {
  const { step, arrange, assertState, members } = ctx;
  const sellerId = members.get('seller').user!.id;
  const release = await arrange('The German seller takes the DE test connected account (payouts live)', () =>
    takeDeFixtureAccount(sellerId),
  );
  try {
    const itemId = await arrange('The German seller lists a card at EUR 150.00', () =>
      seedListing(sellerId, { title: marked(`Pay ${rail.label} ${Date.now()}`), priceMinor: 15_000, place: STUB_PLACES.berlin }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page, rail.deliverTo));

    let expected = { total: '', fee: '', totalMinor: 0, feeMinor: 0 };
    await step(
      `Buyer sees card and ${rail.label} each priced, and chooses ${rail.label}`,
      'buyer',
      async (page) => {
        const row = await saleRow(saleId);
        expect(row.currency, 'the sale is in the German seller’s currency').toBe('eur');
        expected = expectedCharge(row, rail.kind);
        // Chosen but not continued: the fee copy is read from this dialog, which
        // states each rail's rate; the bank step after it states only amounts.
        await chooseRail(await openPayDialog(page), rail.radio, { proceed: false });
      },
      { copy: { fee: { currency: 'EUR', method: rail.kind } } },
    );

    await step(`Buyer approves at the bank and returns to the room`, 'buyer', async (page) => {
      await continueToRail(payDialog(page));
      const bank = page.getByRole('dialog', { name: `Pay with ${rail.label}` });
      await expect(bank).toBeVisible({ timeout: 30_000 });
      await expect(bank.getByText(`Approve ${expected.total} in your bank, including the ${expected.fee} buyer protection fee`, { exact: false })).toBeVisible();
      await fillBankDetails(page, { name: 'E2E Bank Buyer' });
      await bank.getByRole('button', { name: `Pay ${expected.total} with ${rail.label}` }).click();
      await authoriseAtTestBank(page);
    });

    await assertState('The payment is held by the platform', {
      member: 'buyer',
      db: () => saleStatus(saleId),
      ui: visibleSaleStatus,
      expect: 'ESCROW_HELD',
      timeout: HELD_TIMEOUT,
    });
    await assertState(`The sale is priced for ${rail.label} and charged on behalf of the seller`, {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        const intent = await saleIntent(row);
        const charge = intent.latest_charge as { payment_method_details?: { type?: string } } | null;
        return {
          total: formatMoney(row.amount_cents, row.currency),
          received: formatMoney(intent.amount_received, row.currency),
          kind: row.payment_method_kind,
          rail: charge?.payment_method_details?.type ?? null,
          onBehalfOf: typeof intent.on_behalf_of === 'string' ? 'seller' : 'none',
        };
      },
      // The room handles `?payment=return` only while the sale is PAYMENT_PENDING
      // (CashSaleView "BACK FROM THE BANK"). When the webhook has already moved it to
      // ESCROW_HELD the marker, and the params Stripe appends to the return URL, are
      // simply left in place, which is harmless: nothing is read back again. So the
      // marker only counts against the room while the payment is still pending.
      ui: async (page) => {
        const total = await visibleHeaderTotal(page);
        const pendingWithMarker =
          new URL(page.url()).searchParams.get('payment') === 'return' && (await visibleSaleStatus(page)) === 'PAYMENT_PENDING';
        const returned = pendingWithMarker ? 'marker-kept' : rail.stripeType;
        return { total, received: total, kind: rail.kind, rail: returned, onBehalfOf: 'seller' };
      },
      expect: { total: expected.total, received: expected.total, kind: rail.kind, rail: rail.stripeType, onBehalfOf: 'seller' },
    });
  } finally {
    release();
  }
}

const EU_RAIL_VIEWPORTS = 'both' as const;

pathway(
  {
    id: 'cash-sale.payments.bank-ideal',
    title: 'Dutch buyer pays a German seller with iDEAL through the bank redirect',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('ideal-buyer', { regionCode: 'NL', savedCard: true }),
      seller: persona('de-seller', { regionCode: 'DE', identityVerified: true }),
    },
    personaOptions: { buyer: { card: 'pm_card_nl' } },
    viewports: EU_RAIL_VIEWPORTS,
    timeout: EU_RAIL_TIMEOUT,
  },
  (ctx) => euRail(ctx, { kind: 'IDEAL', radio: /^iDEAL/, label: 'iDEAL | Wero', stripeType: 'ideal', deliverTo: STUB_PLACES.amsterdam }),
);

pathway(
  {
    id: 'cash-sale.payments.bank-bancontact',
    title: 'Belgian buyer pays a German seller with Bancontact through the bank redirect',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('bancontact-buyer', { regionCode: 'BE', savedCard: true }),
      seller: persona('de-seller', { regionCode: 'DE', identityVerified: true }),
    },
    personaOptions: { buyer: { card: 'pm_card_be' } },
    viewports: EU_RAIL_VIEWPORTS,
    timeout: EU_RAIL_TIMEOUT,
  },
  (ctx) => euRail(ctx, { kind: 'BANCONTACT', radio: /^Bancontact/, label: 'Bancontact', stripeType: 'bancontact', deliverTo: STUB_PLACES.amsterdam }),
);

pathway(
  {
    id: 'cash-sale.payments.bank-eps',
    title: 'Austrian buyer pays a German seller with EPS through the bank redirect',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('eps-buyer', { regionCode: 'AT', savedCard: true }),
      seller: persona('de-seller', { regionCode: 'DE', identityVerified: true }),
    },
    personaOptions: { buyer: { card: 'pm_card_at' } },
    viewports: EU_RAIL_VIEWPORTS,
    timeout: EU_RAIL_TIMEOUT,
  },
  (ctx) => euRail(ctx, { kind: 'EPS', radio: /^EPS/, label: 'EPS', stripeType: 'eps', deliverTo: STUB_PLACES.berlin }),
);

pathway(
  {
    id: 'cash-sale.payments.bank-p24',
    title: 'Polish buyer pays a German seller with Przelewy24 through the bank redirect',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('p24-buyer', { regionCode: 'PL', savedCard: true }),
      seller: persona('de-seller', { regionCode: 'DE', identityVerified: true }),
    },
    personaOptions: { buyer: { card: 'pm_card_pl' } },
    viewports: EU_RAIL_VIEWPORTS,
    timeout: EU_RAIL_TIMEOUT,
  },
  (ctx) => euRail(ctx, { kind: 'P24', radio: /^Przelewy24/, label: 'Przelewy24', stripeType: 'p24', deliverTo: STUB_PLACES.berlin }),
);

// ═══ Refusals at Pay ══════════════════════════════════════════════════════════════

pathway(
  {
    id: 'cash-sale.payments.card-repriced',
    title: 'Buyer whose saved card changes tier after the total was shown is refused with CARD_REPRICED',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    // Saved card: Stripe's Australian test card, priced as a domestic card.
    members: { buyer: persona('repriced-buyer', { regionCode: 'AU', savedCard: true }), seller: ALICE },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal, members }) => {
    const itemId = await arrange('Alice lists a card at A$150.00', () =>
      seedListing(ALICE.id, { title: marked(`Pay repriced ${Date.now()}`), priceMinor: 15_000 }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));
    const before = await arrange('Read the agreed contract before Pay', () => saleRow(saleId));

    await step(
      'Buyer opens Pay and sees the domestic card total',
      'buyer',
      async (page) => {
        const shown = await shownCardTotal(await openPayDialog(page));
        expect(shown).toBe(expectedCharge(before, 'CARD').total);
      },
      { copy: { fee: { currency: 'AUD', method: 'CARD' } } },
    );
    // A real second session of the same buyer: their account page in another tab,
    // where they save a US-issued card, which Stripe prices as an international card.
    await step('With Pay still open, the buyer saves a US card from their account in another tab', 'buyer', async () => {
      const other = await members.get('buyer').newPage();
      await saveCardFromProfile(other, ENTRY_CARDS.success);
      await other.close();
    });

    await refusal(
      'Buyer confirms the total they were shown and is refused',
      'buyer',
      (page) => captureActionRefusal(page, () => cardConfirm(payDialog(page)).click()),
      { code: 'CARD_REPRICED' },
    );
    await step('The refusal says nothing was charged', 'buyer', async (page) => {
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Nothing was charged' }).first()).toBeVisible({
        timeout: RENDERED,
      });
    });

    await assertState('The sale is unchanged', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return {
          status: row.status,
          amount: row.amount_cents === before.amount_cents && row.terms_version === before.terms_version,
          collected: row.transfer_id !== null,
        };
      },
      ui: async (page) => ({
        status: await visibleSaleStatus(page),
        amount: (await visibleHeaderTotal(page)) === formatMoney(before.amount_cents, before.currency),
        collected: false,
      }),
      expect: { status: 'AGREEMENT', amount: true, collected: false },
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.buyer-identity-required',
    title: 'Unverified buyer of a sale over the unverified-buyer limit is asked to verify their ID instead of paying',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: persona('large-buyer', { regionCode: 'AU', savedCard: true }), seller: ALICE },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal }) => {
    // A$6,000.00: over the A$5,000 limit (`domain/identity/buyerIdentityLimit.ts`).
    const itemId = await arrange('Alice lists a card at A$6,000.00', () =>
      seedListing(ALICE.id, { title: marked(`Pay large ${Date.now()}`), priceMinor: 600_000 }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));

    await refusal(
      'Buyer presses Pay and gets the in-room ID check instead',
      'buyer',
      async (page) => {
        const pay = payButton(page);
        // useInnerText: `PendingLabel` keeps a hidden copy of the label for width.
        await expect(pay).toHaveText('Verify ID to pay', { timeout: RENDERED, useInnerText: true });
        await pay.click();
        const verify = page.getByRole('dialog', { name: 'Verify your ID to pay' });
        await expect(verify).toBeVisible({ timeout: RENDERED });
        await expect(verify.getByText(/Nothing has been charged/)).toBeVisible();
      },
      {
        message: 'Verify your ID to pay',
        // The refusal opens this dialog in the room; it is not a toast.
        messageIn: (page) => page.getByRole('dialog', { name: 'Verify your ID to pay' }),
      },
    );

    await assertState('Nothing was collected and the sale waits for the ID check', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return { status: row.status, collected: row.transfer_id !== null };
      },
      ui: async (page) => ({ status: await visibleSaleStatus(page), collected: false }),
      expect: { status: 'AGREEMENT', collected: false },
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.seller-not-payable',
    title: 'Buyer of a cross-border sale whose seller cannot receive funds is refused with SELLER_NOT_PAYABLE',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    // A German seller with no payout account: their EUR sale is charged on behalf of
    // that account (`domain/payments/onBehalfOf.ts`), so it cannot be taken yet.
    members: {
      buyer: persona('notpayable-buyer', { regionCode: 'NL', savedCard: true }),
      seller: persona('unpaid-de-seller', { regionCode: 'DE', identityVerified: true }),
    },
    personaOptions: { buyer: { card: 'pm_card_nl' } },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal, members }) => {
    const sellerId = members.get('seller').user!.id;
    await arrange('The German seller agrees to their verified name being shown (no payout account)', () =>
      arrangeSellerPersona(sellerId),
    );
    const itemId = await arrange('The German seller lists a card at EUR 150.00', () =>
      seedListing(sellerId, { title: marked(`Pay not payable ${Date.now()}`), priceMinor: 15_000, place: STUB_PLACES.berlin }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page, STUB_PLACES.amsterdam));
    await step('Buyer opens Pay', 'buyer', async (page) => {
      await shownCardTotal(await openPayDialog(page));
    });

    await refusal(
      'Buyer pays by card and is refused',
      'buyer',
      (page) => captureActionRefusal(page, () => cardConfirm(payDialog(page)).click()),
      {
        code: 'SELLER_NOT_PAYABLE',
        message: "The seller hasn't finished setting up payouts yet, so this sale can't be paid. Try again once they have.",
      },
    );

    await assertState('The sale is unchanged and nothing was collected', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return { status: row.status, collected: row.transfer_id !== null };
      },
      ui: async (page) => ({ status: await visibleSaleStatus(page), collected: false }),
      expect: { status: 'AGREEMENT', collected: false },
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.seller-exposure-limit',
    title: 'Buyer is refused with SELLER_EXPOSURE_LIMIT when a new seller would exceed their open-sales limit',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    // A NEW seller with no staff override (the bindings give every seed seller one).
    members: {
      buyer: persona('exposure-buyer', { regionCode: 'AU', savedCard: true }),
      seller: persona('new-seller', { regionCode: 'AU', identityVerified: true }),
    },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal, members }) => {
    const sellerId = members.get('seller').user!.id;
    await arrange('The new seller agrees to their verified name being shown', () => arrangeSellerPersona(sellerId));
    // A$2,100.00 plus the fee: over the A$2,000 new-seller limit
    // (`NEW_SELLER_OPEN_EXPOSURE_MINOR`) and under the A$5,000 buyer ID limit.
    const itemId = await arrange('The new seller lists a card at A$2,100.00', () =>
      seedListing(sellerId, { title: marked(`Pay exposure ${Date.now()}`), priceMinor: 210_000 }),
    );
    const saleId = await step('Buyer reserves it with Buy Now', 'buyer', (page) => buyNow(page, itemId));
    await step('Buyer sets a delivery address', 'buyer', (page) => proposeDelivery(page));
    await step('Buyer opens Pay', 'buyer', async (page) => {
      await shownCardTotal(await openPayDialog(page));
    });

    await refusal(
      'Buyer pays and is refused',
      'buyer',
      (page) => captureActionRefusal(page, () => cardConfirm(payDialog(page)).click()),
      { code: 'SELLER_EXPOSURE_LIMIT', message: CASH_SALE_ERROR_MESSAGES['seller-exposure-limit'] },
    );

    await assertState('The sale is unchanged and nothing was collected', {
      member: 'buyer',
      db: async () => {
        const row = await saleRow(saleId);
        return { status: row.status, collected: row.transfer_id !== null };
      },
      ui: async (page) => ({ status: await visibleSaleStatus(page), collected: false }),
      expect: { status: 'AGREEMENT', collected: false },
    });
  },
);

// ═══ Refusals at Buy Now ══════════════════════════════════════════════════════════

pathway(
  {
    id: 'cash-sale.payments.related-accounts',
    title: 'Two accounts sharing a card cannot deal, and the refusal does not say why',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    knownFindings: ['F78'],
    // Both save the SAME test card number through Payment Element, so the app records
    // the same card fingerprint as a risk signal on each (`completeCardSetup`).
    members: {
      // Labels deliberately avoid the words RELATED_REASON forbids: the seller's
      // display name is in the Buy dialog, and "E2E related seller" matched it.
      buyer: persona('twin-buyer', { regionCode: 'AU' }),
      seller: persona('twin-seller', { regionCode: 'AU', identityVerified: true }),
    },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal, members }) => {
    const sellerId = members.get('seller').user!.id;
    await arrange('The seller agrees to their verified name being shown', () => arrangeSellerPersona(sellerId));
    const itemId = await arrange('The seller lists a card at A$150.00', () =>
      seedListing(sellerId, { title: marked(`Pay twin ${Date.now()}`), priceMinor: 15_000 }),
    );
    await step('The seller saves a card from their account', 'seller', (page) => saveCardFromProfile(page, ENTRY_CARDS.success));
    await step('Buyer opens Buy Now and saves the same card number', 'buyer', async (page) => {
      await page.goto(`/listings/${itemId}`);
      await page.waitForLoadState('domcontentloaded');
      const dialog = await openBuyCheckout(page);
      await dialog.getByRole('button', { name: 'Add a card to continue' }).click();
      await expect(dialog.getByRole('heading', { name: 'Add a payment method' })).toBeVisible({ timeout: 20_000 });
      await saveCardInPaymentElement(page, dialog, ENTRY_CARDS.success);
      await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible({ timeout: 45_000 });
    });

    await refusal(
      'Buyer reserves and is refused',
      'buyer',
      (page) => captureActionRefusal(page, () => reserve(page.getByRole('dialog'))),
      { code: 'RELATED_ACCOUNTS', toastIn: (page) => page.getByRole('dialog') },
    );
    await step('The refusal gives no reason', 'buyer', async (page) => {
      const shown = [
        await page.getByRole('dialog').innerText().catch(() => ''),
        ...(await page.locator('[data-sonner-toast]').allInnerTexts()),
      ].join('\n');
      expect(shown, 'the refusal never says the accounts are related or why').not.toMatch(RELATED_REASON);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: RENDERED });
    });

    await assertState('No contract was opened and the listing is still for sale', {
      member: 'buyer',
      db: () => itemStatus(itemId),
      ui: visibleListingBuyable,
      expect: 'AVAILABLE',
    });
  },
);

pathway(
  {
    id: 'cash-sale.payments.region-mismatch',
    title: 'An Australian buyer cannot open a contract on a US seller’s listing (REGION_MISMATCH)',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: persona('au-buyer', { regionCode: 'AU', savedCard: true }), seller: UMA_US_SELLER },
    viewports: 'both',
    timeout: PAY_TIMEOUT,
  },
  async ({ step, arrange, assertState, refusal }) => {
    const itemId = await arrange('Uma lists a card at US$150.00', () =>
      seedListing(UMA_US_SELLER.id, { title: marked(`Pay region ${Date.now()}`), priceMinor: 15_000, place: STUB_PLACES.portland }),
    );
    await step('Buyer opens the listing and Buy Now', 'buyer', async (page) => {
      await page.goto(`/listings/${itemId}`);
      await page.waitForLoadState('domcontentloaded');
      await openBuyCheckout(page);
    });

    await refusal(
      'Buyer reserves and is refused, told which regions are involved',
      'buyer',
      (page) => captureActionRefusal(page, () => reserve(page.getByRole('dialog'))),
      {
        code: 'REGION_MISMATCH',
        message: regionMismatchMessage({ reason: 'CROSS_REGION', buyerRegion: 'AU', sellerRegion: 'US' }),
        toastIn: (page) => page.getByRole('dialog'),
      },
    );
    await step('Buyer closes the dialog', 'buyer', async (page) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: RENDERED });
    });

    await assertState('No contract was opened and the listing is still for sale', {
      member: 'buyer',
      db: () => itemStatus(itemId),
      ui: visibleListingBuyable,
      expect: 'AVAILABLE',
    });
  },
);

