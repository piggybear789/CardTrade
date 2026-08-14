// tests/unit/cashSaleContract.test.ts
//
// The bilateral Cash_Sale lifecycle (Req 4): Buy reserves without charging,
// versioned terms need both acceptances, cleared funds gate fulfillment, and
// every action is authorized and state-guarded.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  cancelCashSaleAgreement,
  confirmCashSaleHandover,
  ensureCashSaleConversation,
  initiateCashSale,
  platformFeeCentsFor,
  proposeCashSalePrice,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
  type CashSaleTermsInput,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import {
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const CONFIRMED_PURCHASE = {
  buyerId: BUYER.profileId,
  itemId: ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

const DELIVERY_TERMS = {
  fulfillmentMethod: 'DELIVERY' as const,
  shippingCostCents: 1_500,
  deliveryAddress: {
    label: '12 Example St, Melbourne VIC 3000',
    placeId: 'geo:delivery-1',
    countryCode: 'AU',
    lat: -37.8136,
    lng: 144.9631,
  },
  shippingNotes: 'Signature on delivery',
};

function makeDeps(
  overrides: Partial<CashSaleOrchestratorDeps> = {},
  paymentOptions: { transferStatus?: 'SETTLED' | 'FAILED' } = {},
) {
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments(paymentOptions);
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    ...overrides,
  };
  return { deps, state, calls };
}

/**
 * Save DELIVERY terms the way the room does, in two saves by two parties.
 *
 * Postage belongs to the seller (they choose the carrier and pay it) and the
 * address belongs to the buyer; neither may set the other's field. The seller goes
 * first so the buyer's save carries a postage figure equal to the stored one, which
 * is the unchanged-value case the guard permits.
 *
 * Returns the buyer's save, i.e. the final terms version.
 */
async function agreeDeliveryTerms(
  deps: CashSaleOrchestratorDeps,
  saleId: string,
  fromVersion: number,
  terms: CashSaleTermsInput = DELIVERY_TERMS,
) {
  const priced = await updateCashSaleTerms(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: saleId,
    expectedTermsVersion: fromVersion,
    terms: { ...terms, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error(`postage failed: ${priced.error}`);
  return updateCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms,
  });
}

/** Drive a sale to both-accepted so payment is submitted. */
async function agreeAndPay(
  deps: CashSaleOrchestratorDeps,
  // Typed as the domain input rather than inferred from DELIVERY_TERMS, whose
  // literal `'DELIVERY'` would otherwise reject an IN_PERSON fixture.
  terms: CashSaleTermsInput = DELIVERY_TERMS,
) {
  const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
  if (!created.ok) throw new Error(`agreement failed: ${created.error}`);
  const saleId = created.sale.id;

  // A DELIVERY sale needs both parties: see `agreeDeliveryTerms`. IN_PERSON has no
  // postage to price, so one save by the buyer is enough.
  const updated =
    terms.fulfillmentMethod === 'DELIVERY'
      ? await agreeDeliveryTerms(deps, saleId, created.sale.termsVersion, terms)
      : await updateCashSaleTerms(deps, {
          actorId: BUYER.profileId,
          cashSaleId: saleId,
          expectedTermsVersion: created.sale.termsVersion,
          terms,
        });
  if (!updated.ok) throw new Error(`terms failed: ${updated.error}`);
  const version = updated.sale.termsVersion;
  await acceptCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
    termsVersion: version,
  });
  const second = await acceptCashSaleTerms(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: saleId,
    termsVersion: version,
  });
  return { saleId, version, second };
}

describe('cash sale — agreement stage', () => {
  it('reserves the item and collects no money on Buy', async () => {
    const { deps, state, calls } = makeDeps();

    const result = await initiateCashSale(deps, CONFIRMED_PURCHASE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('AGREEMENT');
    expect(result.sale.amountCents).toBe(
      ITEM.fmvCents + platformFeeCentsFor(ITEM.fmvCents),
    );
    expect(state.item.status).toBe('RESERVED');
    expect(calls.transfers).toHaveLength(0);
  });

  it('rejects a buyer with no vaulted payment source', async () => {
    const { repository } = makeCashSaleRepository({
      buyer: { ...BUYER, paymentSourceId: null },
    });
    const { payments } = makePayments();
    const result = await initiateCashSale(
      {
        repository,
        payments: payments as unknown as PaymentService,
        tracking: fakeTracking,
      },
      CONFIRMED_PURCHASE,
    );
    expect(result).toMatchObject({ ok: false, error: 'BUYER_NO_PAYMENT_METHOD' });
  });

  it('rejects a seller buying their own listing', async () => {
    const { deps } = makeDeps();
    const result = await initiateCashSale(deps, {
      ...CONFIRMED_PURCHASE,
      buyerId: ITEM.ownerId,
    });
    expect(result).toMatchObject({ ok: false, error: 'SELF_PURCHASE' });
  });

  it('rejects an unconfirmed or stale seller identity before reserving', async () => {
    const { deps, state } = makeDeps();
    const unconfirmed = await initiateCashSale(deps, {
      ...CONFIRMED_PURCHASE,
      buyerConfirmedSellerIdentity: false,
    });
    const stale = await initiateCashSale(deps, {
      ...CONFIRMED_PURCHASE,
      sellerIdentityVersion: 'seller-v0',
    });
    expect(unconfirmed).toMatchObject({ ok: false, error: 'BUYER_CONFIRMATION_REQUIRED' });
    expect(stale).toMatchObject({ ok: false, error: 'SELLER_IDENTITY_CHANGED' });
    expect(state.item.status).toBe('AVAILABLE');
  });

  it('accepts at most one concurrent agreement for an item', async () => {
    const { deps } = makeDeps();
    const first = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    const second = await initiateCashSale(deps, {
      ...CONFIRMED_PURCHASE,
      buyerId: 'buyer-2',
    });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: 'ITEM_UNAVAILABLE' });
  });

  it('cancels free before payment and returns the item to the catalog', async () => {
    const { deps, state, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const cancelled = await cancelCashSaleAgreement(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
    });

    expect(cancelled).toMatchObject({ ok: true });
    expect(state.item.status).toBe('AVAILABLE');
    expect(calls.transfers).toHaveLength(0);
  });

  it('refuses actions from a non-participant', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const result = await updateCashSaleTerms(deps, {
      actorId: 'stranger',
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });
    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
  });
});

describe('cash sale — terms and dual acceptance', () => {
  it('requires complete terms for the chosen fulfillment method', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    // Postage stays at the stored 0 so this exercises the MISSING ADDRESS, not the
    // seller-owns-postage guard. 0 is a legitimate figure — the seller has priced
    // postage into the item — so an incomplete DELIVERY sale is one with no address.
    const missingAddress = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { fulfillmentMethod: 'DELIVERY', shippingCostCents: 0 },
    });
    const missingLocation = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { fulfillmentMethod: 'IN_PERSON' },
    });

    expect(missingAddress).toMatchObject({ ok: false, error: 'INVALID_TERMS' });
    expect(missingLocation).toMatchObject({ ok: false, error: 'INVALID_TERMS' });
  });

  it('adds shipping cost to the contract total', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const updated = await agreeDeliveryTerms(deps, created.sale.id, created.sale.termsVersion);

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.sale.amountCents).toBe(
      ITEM.fmvCents +
        platformFeeCentsFor(ITEM.fmvCents) +
        DELIVERY_TERMS.shippingCostCents,
    );
  });

  it('does not pay on the first acceptance alone', async () => {
    const { deps, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const updated = await agreeDeliveryTerms(deps, created.sale.id, created.sale.termsVersion);
    if (!updated.ok) throw new Error('setup failed');

    const first = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      termsVersion: updated.sale.termsVersion,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.sale.status).toBe('AGREEMENT');
    expect(calls.transfers).toHaveLength(0);
  });

  it('submits exactly one payment with a persisted nonce when both accept', async () => {
    const { deps, calls } = makeDeps();
    const { second } = await agreeAndPay(deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Successful realtime transfers settle synchronously (Stripe + mock), so the
    // sale advances past PAYMENT_PENDING without a separate webhook.
    expect(second.sale.status).toBe('ESCROW_HELD');
    expect(calls.transfers).toHaveLength(1);
    expect(calls.transfers[0].nonce).toBe(second.sale.paymentNonce);
    expect(calls.transfers[0].amount).toBe(second.sale.amountCents);
  });

  it('clears both acceptances when terms change', async () => {
    const { deps, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const v2 = await agreeDeliveryTerms(deps, created.sale.id, created.sale.termsVersion);
    if (!v2.ok) throw new Error('setup failed');
    await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      termsVersion: v2.sale.termsVersion,
    });

    const v3 = await updateCashSaleTerms(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: v2.sale.termsVersion,
      terms: {
        fulfillmentMethod: 'DELIVERY',
        shippingCostCents: 2_500,
        shippingNotes: DELIVERY_TERMS.shippingNotes,
      },
    });

    expect(v3.ok).toBe(true);
    if (!v3.ok) return;
    expect(v3.sale.buyerTermsAcceptedVersion).toBeNull();
    expect(v3.sale.sellerTermsAcceptedVersion).toBeNull();
    expect(v3.sale.termsVersion).toBe(v2.sale.termsVersion + 1);
    expect(calls.transfers).toHaveLength(0);
  });

  it('rejects an acceptance for a superseded terms version', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const staleVersion = created.sale.termsVersion;
    await agreeDeliveryTerms(deps, created.sale.id, staleVersion);

    const result = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      termsVersion: staleVersion,
    });
    expect(result).toMatchObject({ ok: false, error: 'STALE_TERMS' });
  });

  it('lets only the seller price postage', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    // The seller chooses the carrier and pays them, so the buyer proposing their
    // own postage is a figure the seller would have to undo. Mirrors the rule that
    // only the buyer may set the delivery address.
    const buyerPrices = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { ...DELIVERY_TERMS, shippingCostCents: 9_999 },
    });
    expect(buyerPrices).toMatchObject({ ok: false, error: 'NOT_PERMITTED' });

    const sellerPrices = await updateCashSaleTerms(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { fulfillmentMethod: 'DELIVERY', shippingCostCents: 9_999 },
    });
    expect(sellerPrices.ok).toBe(true);
    if (!sellerPrices.ok) return;
    expect(sellerPrices.sale.shippingCostCents).toBe(9_999);
  });

  it('still lets the buyer save their address while postage stays put', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    // The buyer's save carries the WHOLE terms object, postage included. Refusing
    // it outright would make the address unsettable; only a CHANGE is refused.
    const priced = await updateCashSaleTerms(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { fulfillmentMethod: 'DELIVERY', shippingCostCents: 1_500 },
    });
    if (!priced.ok) throw new Error('setup failed');

    const buyerSaves = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: priced.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });

    expect(buyerSaves.ok).toBe(true);
    if (!buyerSaves.ok) return;
    expect(buyerSaves.sale.shippingCostCents).toBe(1_500);
    expect(buyerSaves.sale.deliveryAddressConfigured).toBe(true);
  });

  it('treats zero postage as complete, so it can be priced into the item', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const updated = await agreeDeliveryTerms(deps, created.sale.id, created.sale.termsVersion, {
      ...DELIVERY_TERMS,
      shippingCostCents: 0,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    // No postage line, so the buyer pays item + fee only.
    expect(updated.sale.amountCents).toBe(
      ITEM.fmvCents + platformFeeCentsFor(ITEM.fmvCents),
    );
  });

  it('does not double-charge when the same party accepts twice', async () => {
    const { deps, calls } = makeDeps();
    const { saleId, version } = await agreeAndPay(deps);

    const repeat = await acceptCashSaleTerms(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      termsVersion: version,
    });

    expect(repeat).toMatchObject({ ok: false, error: 'INVALID_STATE' });
    expect(calls.transfers).toHaveLength(1);
  });

  it('fails the contract and frees the item when the provider declines', async () => {
    const { deps, state } = makeDeps({}, { transferStatus: 'FAILED' });
    const { second } = await agreeAndPay(deps);

    expect(second).toMatchObject({ ok: false, error: 'TRANSFER_FAILED' });
    expect(state.sale?.status).toBe('FAILED');
    expect(state.item.status).toBe('AVAILABLE');
  });
});

describe('cash sale — fulfillment', () => {
  it('allows shipment once payment has cleared, and requires tracking', async () => {
    const { deps, state } = makeDeps();
    const { saleId, second } = await agreeAndPay(deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.sale.status).toBe('ESCROW_HELD');

    // A second settle after sync clearance is a no-op / invalid-state.
    const settledAgain = await settleCashSale(deps, { cashSaleId: saleId });
    expect(settledAgain).toMatchObject({ ok: false, error: 'INVALID_STATE' });

    const missingTracking = await recordCashSaleShipment(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: '' },
    });
    expect(missingTracking).toMatchObject({ ok: false, error: 'INVALID_TERMS' });

    const shipped = await recordCashSaleShipment(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456' },
    });
    expect(shipped.ok).toBe(true);
    if (!shipped.ok) return;
    expect(shipped.sale.status).toBe('IN_TRANSIT');
    expect(shipped.sale.trackingUrl).toContain('AP123456');
    expect(state.item.status).toBe('RESERVED');
  });

  it('only lets the seller ship and only the buyer receive', async () => {
    const { deps } = makeDeps();
    const { saleId } = await agreeAndPay(deps);
    await settleCashSale(deps, { cashSaleId: saleId });

    const buyerShips = await recordCashSaleShipment(deps, {
      actorId: BUYER.profileId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456' },
    });
    expect(buyerShips).toMatchObject({ ok: false, error: 'NOT_PERMITTED' });

    await recordCashSaleShipment(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456' },
    });
    const sellerReceives = await recordCashSaleReceipt(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
    });
    expect(sellerReceives).toMatchObject({ ok: false, error: 'NOT_PERMITTED' });
  });

  it('completes a delivery after receipt and buyer acceptance', async () => {
    const { deps, state } = makeDeps();
    const { saleId } = await agreeAndPay(deps);
    await settleCashSale(deps, { cashSaleId: saleId });
    await recordCashSaleShipment(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456' },
    });

    const received = await recordCashSaleReceipt(deps, {
      actorId: BUYER.profileId,
      cashSaleId: saleId,
    });
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(received.sale.status).toBe('INSPECTION');

    const completed = await acceptCashSaleInspection(deps, {
      actorId: BUYER.profileId,
      cashSaleId: saleId,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.sale.status).toBe('COMPLETED');
    expect(state.item.status).toBe('SOLD');
  });

  it('needs both confirmations to complete a face-to-face handover', async () => {
    const { deps, state } = makeDeps();
    const { saleId, second } = await agreeAndPay(deps, {
      fulfillmentMethod: 'IN_PERSON',
      meetingLocation: 'Melbourne Central, main concourse',
      meetingPlaceId: 'geo:meeting-1',
      meetingLat: -37.8183,
      meetingLng: 144.9671,
      meetingAt: '2099-01-15T03:00:00.000Z',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // In-person sales settle straight into HANDOVER when the transfer clears.
    expect(second.sale.status).toBe('HANDOVER');

    const buyerConfirm = await confirmCashSaleHandover(deps, {
      actorId: BUYER.profileId,
      cashSaleId: saleId,
    });
    expect(buyerConfirm.ok).toBe(true);
    if (!buyerConfirm.ok) return;
    expect(buyerConfirm.sale.status).toBe('HANDOVER');

    const repeat = await confirmCashSaleHandover(deps, {
      actorId: BUYER.profileId,
      cashSaleId: saleId,
    });
    expect(repeat).toMatchObject({ ok: false, error: 'ALREADY_RECORDED' });

    const sellerConfirm = await confirmCashSaleHandover(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
    });
    expect(sellerConfirm.ok).toBe(true);
    if (!sellerConfirm.ok) return;
    expect(sellerConfirm.sale.status).toBe('COMPLETED');
    expect(state.item.status).toBe('SOLD');
  });
});

describe('cash sale — contract chat', () => {
  it('opens one participant thread and reuses it', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const first = await ensureCashSaleConversation(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
    });
    const second = await ensureCashSaleConversation(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.sale.conversationId).toBeTruthy();
    expect(second.sale.conversationId).toBe(first.sale.conversationId);
  });

  it('refuses to open a contract chat for a non-participant', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const result = await ensureCashSaleConversation(deps, {
      actorId: 'stranger',
      cashSaleId: created.sale.id,
    });
    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
  });
});

describe('cash sale — price renegotiation', () => {
  it('reprices the contract and clears both acceptances', async () => {
    const { deps, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const withTerms = await agreeDeliveryTerms(deps, created.sale.id, created.sale.termsVersion);
    if (!withTerms.ok) throw new Error('setup failed');
    // The BUYER accepts first, so this asserts the thing that actually matters: a
    // seller's discount does not silently keep the buyer's consent to the old number.
    await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      termsVersion: withTerms.sale.termsVersion,
    });

    const repriced = await proposeCashSalePrice(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: withTerms.sale.termsVersion,
      agreedPriceCents: 8_000,
    });

    expect(repriced.ok).toBe(true);
    if (!repriced.ok) return;
    expect(repriced.sale.agreedPriceCents).toBe(8_000);
    expect(repriced.sale.amountCents).toBe(
      // Repricing re-derives the percentage fee from the NEW price.
      8_000 + platformFeeCentsFor(8_000) + DELIVERY_TERMS.shippingCostCents,
    );
    // Cleared, so nothing can be charged on a number the buyer never agreed to. This is
    // what makes a private discount safe rather than merely convenient — and it applies
    // to a price CUT too, because a buyer is entitled to know what they are paying.
    expect(repriced.sale.buyerTermsAcceptedVersion).toBeNull();
    expect(repriced.sale.termsVersion).toBe(withTerms.sale.termsVersion + 1);
    expect(calls.transfers).toHaveLength(0);
  });

  // THE XIANYU ASYMMETRY. The seller can discount privately; the buyer cannot edit what
  // they are about to be charged. Their channel is an Offer before the contract, or
  // asking in the chat — a request, not a write.
  it('refuses a buyer changing the price, and says where to ask instead', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const result = await proposeCashSalePrice(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      agreedPriceCents: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // NOT_PERMITTED rather than NOT_PARTICIPANT: they are on the contract, they just do
    // not own this field, and the two need different things said to them.
    expect(result.error).toBe('NOT_PERMITTED');

    // And the price is untouched — the refusal is not merely cosmetic.
    const current = await deps.repository.loadCashSale(created.sale.id);
    expect(current?.agreedPriceCents).toBe(created.sale.agreedPriceCents);
  });

  it('rejects a non-participant, an invalid price, and a stale version', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const version = created.sale.termsVersion;

    const stranger = await proposeCashSalePrice(deps, {
      actorId: 'stranger',
      cashSaleId: created.sale.id,
      expectedTermsVersion: version,
      agreedPriceCents: 5_000,
    });
    const invalid = await proposeCashSalePrice(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: version,
      agreedPriceCents: 0,
    });
    const stale = await proposeCashSalePrice(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: version + 5,
      agreedPriceCents: 5_000,
    });

    expect(stranger).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
    expect(invalid).toMatchObject({ ok: false, error: 'INVALID_TERMS' });
    expect(stale).toMatchObject({ ok: false, error: 'STALE_TERMS' });
  });

  it('refuses a price change once payment has started', async () => {
    const { deps } = makeDeps();
    const { saleId, version } = await agreeAndPay(deps);

    const result = await proposeCashSalePrice(deps, {
      // The SELLER, so this exercises the payment lock rather than stopping at the
      // seller-only permission guard. The lock is the point: once money has been
      // collected, not even the party who owns this field may move it.
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      expectedTermsVersion: version,
      agreedPriceCents: 1_000,
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_STATE' });
  });
});
