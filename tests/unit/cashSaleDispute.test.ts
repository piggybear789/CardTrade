// tests/unit/cashSaleDispute.test.ts
//
// Resolving a disputed Cash_Sale (Req 4.15).
//
// This closes what was the single worst hole in the money flow: `disputeCashSale`
// could move a sale to DISPUTED, and nothing anywhere could move it out. There was
// no refund primitive on the payment seam, no resolution action, and no operator
// control, so the Buyer's money stayed in the platform balance permanently — while
// the dispute dialog told them they would be refunded.
//
// The properties worth protecting, in order of how much money a regression costs:
//
//   1. A failed refund leaves the sale DISPUTED. A "resolved" sale whose money
//      never moved is undetectable after the fact.
//   2. A refund happens at most once. It spends the platform's own funds, since the
//      Buyer was only ever debited once.
//   3. A partial refund reduces the seller release by exactly the refunded amount.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  disputeCashSale,
  initiateCashSale,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  resolveCashSaleDispute,
  sellerNetCentsFor,
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

const OPERATOR = 'admin-1';

const PURCHASE = {
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
};

function makeDeps(
  paymentOptions: {
    refundStatus?: 'SETTLED' | 'FAILED';
    payoutStatus?: 'SETTLED' | 'FAILED';
  } = {},
) {
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments(paymentOptions);
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  return { deps, state, calls };
}

/** Drive a sale all the way to DISPUTED, which is the only resolvable state. */
async function disputedSale(deps: CashSaleOrchestratorDeps) {
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup: could not initiate');
  const saleId = created.sale.id;

  // Two saves by two parties: postage is the seller's to price, the address is the
  // buyer's. The seller goes first so the buyer's save leaves postage unchanged,
  // which is the only way a buyer may carry that field.
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: could not price postage');

  await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  const sale = await deps.repository.loadCashSale(saleId);
  if (!sale) throw new Error('setup: sale vanished');

  await acceptCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    termsVersion: sale.termsVersion,
  });
  await acceptCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    termsVersion: sale.termsVersion,
  });
  await settleCashSale(deps, { cashSaleId: saleId });
  await recordCashSaleShipment(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456789AU' },
  });
  await recordCashSaleReceipt(deps, { cashSaleId: saleId, actorId: BUYER.profileId });
  const disputed = await disputeCashSale(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    reason: 'Arrived with a crease not shown in the listing photos.',
  });
  if (!disputed.ok) throw new Error('setup: could not dispute');
  return disputed.sale;
}

describe('resolveCashSaleDispute', () => {
  it('refunds the buyer in full and ends the sale REFUNDED', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(result.ok).toBe(true);
    expect(state.sale?.status).toBe('REFUNDED');
    expect(state.sale?.disputeResolution).toBe('REFUND_BUYER');
    expect(state.sale?.refundCents).toBe(sale.amountCents);
    expect(calls.refunds).toHaveLength(1);
    expect(calls.refunds[0].amount).toBe(sale.amountCents);
    // The exchange did not stand, so the seller can relist.
    expect(state.item.status).toBe('AVAILABLE');
    // Nothing is released to the seller on a full refund.
    expect(calls.payouts).toHaveLength(0);
  });

  it('releases to the seller in full when the dispute is not upheld', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(true);
    expect(state.sale?.status).toBe('COMPLETED');
    expect(state.sale?.refundCents).toBe(0);
    // No refund call at all: RELEASE_SELLER must not touch the buyer's card.
    expect(calls.refunds).toHaveLength(0);
    expect(state.item.status).toBe('SOLD');
    expect(calls.payouts).toHaveLength(1);
    expect(calls.payouts[0].amount).toBe(sellerNetCentsFor({ ...sale, refundCents: 0 }));
  });

  it('splits a partial refund between buyer and seller', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);
    const refund = 2_000;

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'PARTIAL_REFUND',
      refundCents: refund,
    });

    expect(result.ok).toBe(true);
    expect(state.sale?.status).toBe('COMPLETED');
    expect(state.sale?.refundCents).toBe(refund);
    expect(calls.refunds[0].amount).toBe(refund);
    // The buyer keeps the item.
    expect(state.item.status).toBe('SOLD');
    // The release is reduced by exactly the refund, so the platform absorbs nothing.
    expect(calls.payouts).toHaveLength(1);
    expect(calls.payouts[0].amount).toBe(sellerNetCentsFor({ ...sale, refundCents: refund }));
    expect(calls.payouts[0].amount + refund).toBe(
      sellerNetCentsFor({ ...sale, refundCents: 0 }),
    );
  });

  it('leaves the sale DISPUTED when the provider rejects the refund', async () => {
    const { deps, state, calls } = makeDeps({ refundStatus: 'FAILED' });
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(result).toMatchObject({ ok: false, error: 'REFUND_FAILED' });
    // The whole point: a refusal must NOT look like a resolution.
    expect(state.sale?.status).toBe('DISPUTED');
    expect(state.sale?.disputeResolution).toBeNull();
    expect(state.sale?.refundStatus).toBe('FAILED');
    expect(calls.payouts).toHaveLength(0);
  });

  it('is retryable after a refund failure and reuses the same nonce', async () => {
    const { deps, state } = makeDeps({ refundStatus: 'FAILED' });
    const sale = await disputedSale(deps);

    await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });
    const firstNonce = state.sale?.refundNonce;

    await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(firstNonce).toBeTruthy();
    // Regenerating the nonce would let the provider treat the retry as a second,
    // distinct refund — paying the buyer twice out of platform funds.
    expect(state.sale?.refundNonce).toBe(firstNonce);
  });

  it('does not refund twice when resolution is repeated', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);

    await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });
    const second = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(second.ok).toBe(true);
    expect(calls.refunds).toHaveLength(1);
    expect(state.sale?.status).toBe('REFUNDED');
  });

  it('rejects a partial refund of zero or of the whole amount', async () => {
    for (const refundCents of [0, -100]) {
      const { deps, state, calls } = makeDeps();
      const sale = await disputedSale(deps);
      const result = await resolveCashSaleDispute(deps, {
        cashSaleId: sale.id,
        actorId: OPERATOR,
        outcome: 'PARTIAL_REFUND',
        refundCents,
      });
      expect(result).toMatchObject({ ok: false, error: 'INVALID_REFUND_AMOUNT' });
      expect(state.sale?.status).toBe('DISPUTED');
      expect(calls.refunds).toHaveLength(0);
    }

    const { deps, state } = makeDeps();
    const sale = await disputedSale(deps);
    const whole = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'PARTIAL_REFUND',
      refundCents: sale.amountCents,
    });
    // A partial refund of everything should be expressed as REFUND_BUYER, which
    // ends the sale REFUNDED and relists the item — a different outcome.
    expect(whole).toMatchObject({ ok: false, error: 'INVALID_REFUND_AMOUNT' });
    expect(state.sale?.status).toBe('DISPUTED');
  });

  it('refuses to resolve a sale that is not disputed', async () => {
    const { deps } = makeDeps();
    const created = await initiateCashSale(deps, PURCHASE);
    if (!created.ok) throw new Error('setup failed');

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: created.sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(result).toMatchObject({ ok: false, error: 'INVALID_STATE' });
  });

  it('reports a missing sale rather than inventing one', async () => {
    const { deps } = makeDeps();
    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: 'nope',
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });
    expect(result).toMatchObject({ ok: false, error: 'CASH_SALE_NOT_FOUND' });
  });

  it('keeps the decision when the follow-up release fails', async () => {
    const { deps, state } = makeDeps({ payoutStatus: 'FAILED' });
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });

    // The dispute IS resolved; only the transfer is outstanding. Un-resolving it
    // would reopen an argument that has already been decided.
    expect(result.ok).toBe(true);
    expect(state.sale?.status).toBe('COMPLETED');
    expect(state.sale?.disputeResolution).toBe('RELEASE_SELLER');
    expect(state.sale?.sellerPayoutStatus).toBe('FAILED');
  });

  it('records an auditable resolution event naming the outcome', async () => {
    const { deps, state } = makeDeps();
    const sale = await disputedSale(deps);

    await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    // Recorded against the OPERATOR, not a participant: the audit trail has to say
    // who made a call that moved someone else's money.
    expect(state.events).toEqual(
      expect.arrayContaining([
        { event: 'DISPUTE_RESOLVED_REFUND_BUYER', actorId: OPERATOR },
      ]),
    );
  });
});

describe('acceptCashSaleInspection after a dispute', () => {
  it('cannot complete a disputed sale behind the operator', async () => {
    const { deps, state } = makeDeps();
    const sale = await disputedSale(deps);

    const result = await acceptCashSaleInspection(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
    });

    expect(result.ok).toBe(false);
    expect(state.sale?.status).toBe('DISPUTED');
  });
});
