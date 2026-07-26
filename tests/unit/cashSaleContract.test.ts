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
  PLATFORM_FEE_CENTS,
  proposeCashSalePrice,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
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
  deliveryAddress: '12 Example St, Melbourne VIC 3000',
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

/** Drive a sale to both-accepted so payment is submitted. */
async function agreeAndPay(
  deps: CashSaleOrchestratorDeps,
  terms = DELIVERY_TERMS,
) {
  const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
  if (!created.ok) throw new Error(`agreement failed: ${created.error}`);
  const saleId = created.sale.id;
  const updated = await updateCashSaleTerms(deps, {
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
    expect(result.sale.amountCents).toBe(ITEM.fmvCents + PLATFORM_FEE_CENTS);
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

    const missingAddress = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: { fulfillmentMethod: 'DELIVERY', shippingCostCents: 500 },
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

    const updated = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.sale.amountCents).toBe(
      ITEM.fmvCents + PLATFORM_FEE_CENTS + DELIVERY_TERMS.shippingCostCents,
    );
  });

  it('does not pay on the first acceptance alone', async () => {
    const { deps, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const updated = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });
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
    expect(second.sale.status).toBe('PAYMENT_PENDING');
    expect(calls.transfers).toHaveLength(1);
    expect(calls.transfers[0].nonce).toBe(second.sale.paymentNonce);
    expect(calls.transfers[0].amount).toBe(second.sale.amountCents);
  });

  it('clears both acceptances when terms change', async () => {
    const { deps, calls } = makeDeps();
    const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
    if (!created.ok) throw new Error('setup failed');
    const v2 = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });
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
      terms: { ...DELIVERY_TERMS, shippingCostCents: 2_500 },
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
    await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: staleVersion,
      terms: DELIVERY_TERMS,
    });

    const result = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      termsVersion: staleVersion,
    });
    expect(result).toMatchObject({ ok: false, error: 'STALE_TERMS' });
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
  it('blocks shipment until the payment clears, then requires tracking', async () => {
    const { deps, state } = makeDeps();
    const { saleId } = await agreeAndPay(deps);

    const early = await recordCashSaleShipment(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: saleId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456' },
    });
    expect(early).toMatchObject({ ok: false, error: 'INVALID_STATE' });

    const settled = await settleCashSale(deps, { cashSaleId: saleId });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.sale.status).toBe('ESCROW_HELD');

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
    const { saleId } = await agreeAndPay(deps, {
      fulfillmentMethod: 'IN_PERSON',
      meetingLocation: 'Melbourne Central, main concourse',
    } as typeof DELIVERY_TERMS);

    const settled = await settleCashSale(deps, { cashSaleId: saleId });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.sale.status).toBe('HANDOVER');

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
    const withTerms = await updateCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: created.sale.termsVersion,
      terms: DELIVERY_TERMS,
    });
    if (!withTerms.ok) throw new Error('setup failed');
    await acceptCashSaleTerms(deps, {
      actorId: ITEM.ownerId,
      cashSaleId: created.sale.id,
      termsVersion: withTerms.sale.termsVersion,
    });

    const repriced = await proposeCashSalePrice(deps, {
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: withTerms.sale.termsVersion,
      agreedPriceCents: 8_000,
    });

    expect(repriced.ok).toBe(true);
    if (!repriced.ok) return;
    expect(repriced.sale.agreedPriceCents).toBe(8_000);
    expect(repriced.sale.amountCents).toBe(
      8_000 + PLATFORM_FEE_CENTS + DELIVERY_TERMS.shippingCostCents,
    );
    expect(repriced.sale.sellerTermsAcceptedVersion).toBeNull();
    expect(repriced.sale.termsVersion).toBe(withTerms.sale.termsVersion + 1);
    expect(calls.transfers).toHaveLength(0);
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
      actorId: BUYER.profileId,
      cashSaleId: created.sale.id,
      expectedTermsVersion: version,
      agreedPriceCents: 0,
    });
    const stale = await proposeCashSalePrice(deps, {
      actorId: BUYER.profileId,
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
      actorId: BUYER.profileId,
      cashSaleId: saleId,
      expectedTermsVersion: version,
      agreedPriceCents: 1_000,
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_STATE' });
  });
});
