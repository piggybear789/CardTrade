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
  initiateCashSale,
  resolveCashSaleDispute,
  sellerNetCentsFor,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import {
  BUYER,
  fakeTracking,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';
// The walk to DISPUTED and the fixtures it needs now live in the shared helper; the
// individual step functions are no longer called from this file.
import { disputedCashSale, PURCHASE } from './helpers/disputedCashSale';

const OPERATOR = 'admin-1';

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

// The long, order-sensitive walk to DISPUTED now lives in
// `helpers/disputedCashSale.ts`, shared with the refund-drain tests so the two cannot
// drift into testing different states while believing they test the same one.
const disputedSale = disputedCashSale;

describe('resolveCashSaleDispute', () => {
  // The shared fixture takes the sale through `recordCashSaleReceipt`, so the Buyer
  // demonstrably HAS the goods. Since 0088 a full refund in that position waits for
  // them to come back rather than paying out immediately — see
  // `.kiro/specs/return-refunds/requirements.md`.
  it('makes a full refund wait on the return when the buyer has the goods', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
      // No `requireReturn` on purpose: this asserts the DERIVATION picks the return
      // flow up from the record, which is the behaviour that matters. Passing the
      // override here would test the override instead.
    });

    expect(result.ok).toBe(true);
    expect(state.sale?.status).toBe('RETURN_PENDING');
    expect(state.sale?.disputeResolution).toBe('REFUND_BUYER');
    // A dispatch deadline is what the sweep later acts on.
    expect(state.sale?.returnDeadlineAt).toBeTruthy();
    // NO MONEY MOVED and NOTHING WAS RELISTED. Both wait for the carrier to confirm
    // the return reached the seller; relisting now would advertise goods in transit.
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(0);
    expect(state.item.status).not.toBe('AVAILABLE');
  });

  // The lost-parcel and never-shipped cases, plus an operator override for an empty
  // box: there is nothing to send back, so the refund goes out at once.
  it('refunds immediately and relists when no return is required', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await disputedSale(deps);

    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
      requireReturn: false,
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
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
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
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
    });
    const firstNonce = state.sale?.refundNonce;

    await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
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
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
    });
    const second = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
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
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
    });

    expect(result).toMatchObject({ ok: false, error: 'INVALID_STATE' });
  });

  it('reports a missing sale rather than inventing one', async () => {
    const { deps } = makeDeps();
    const result = await resolveCashSaleDispute(deps, {
      cashSaleId: 'nope',
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
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
      // Exercises the refund MECHANICS, so it takes the direct path rather than the
      // return flow (0088). Without this the sale would stop at RETURN_PENDING and
      // no refund would be attempted for this test to observe.
      requireReturn: false,
    });

    // Recorded against the OPERATOR, not a participant: the audit trail has to say
    // who made a call that moved someone else's money.
    //
    // `objectContaining` because the recorded event also carries the from/to statuses
    // (needed by the 0084 withdrawal path, which reads the pre-dispute status back out
    // of this log). The assertion is about the event code and the actor, so it should
    // not fail every time another audit field is added.
    expect(state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'DISPUTE_RESOLVED_REFUND_BUYER',
          actorId: OPERATOR,
        }),
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
