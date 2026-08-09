// tests/unit/cashSaleRefundDrain.test.ts
//
// Retrying a refund owed to a Buyer that did not land (Req 4.15).
//
// WHY THIS DRAIN EXISTS AT ALL. A refund the provider rejected was recorded FAILED and
// then read by NOTHING — no job, no action, no admin control. `0045_refund_failure_reopen.sql`
// reopens a FULL refund so a resolution can be made again, but deliberately not a PARTIAL
// one. So a partial refund that bounced was terminal: the Buyer's money stayed in the
// platform balance for good, while `sellerNetCentsFor` kept subtracting that same amount
// from the Seller's release. Neither party had it, and nothing anywhere said so.
//
// The properties that matter here are the same ones the payout drain has, and they are
// worth more on this side because the money belongs to a member rather than to us:
//
//   1. A stuck refund is picked up again. Silence in the platform's favour is the worst
//      failure mode a refund can have.
//   2. The retry REUSES the persisted nonce. That is what makes retrying safe: if the
//      first attempt actually succeeded and only the response was lost, the provider
//      replays it instead of paying the Buyer twice.
//   3. A settled refund is never retried, and the attempt budget is respected, so a
//      permanently broken refund stops burning attempts and waits for an operator.

import { describe, expect, it } from 'vitest';

import {
  processDueCashSaleRefunds,
  resolveCashSaleDispute,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import {
  fakeTracking,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';

const OPERATOR = 'admin-1';
const PARTIAL_REFUND_CENTS = 2_000;

/**
 * Deps whose refund outcome can be flipped mid-test.
 *
 * `makePayments` reads `options.refundStatus` at call time rather than capturing it, so
 * mutating this object between calls models the real case: the provider refused once and
 * accepts on a later attempt.
 */
function makeDeps() {
  const paymentOptions: { refundStatus: 'SETTLED' | 'FAILED' } = { refundStatus: 'FAILED' };
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments(paymentOptions);
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  return { deps, state, calls, paymentOptions };
}

/** A sale whose PARTIAL refund was queued and then refused by the provider. */
async function saleWithStuckRefund(deps: CashSaleOrchestratorDeps) {
  const sale = await disputedCashSale(deps);
  const attempted = await resolveCashSaleDispute(deps, {
    cashSaleId: sale.id,
    actorId: OPERATOR,
    outcome: 'PARTIAL_REFUND',
    refundCents: PARTIAL_REFUND_CENTS,
  });
  // The refund failing is the whole premise; the resolution must NOT have succeeded.
  expect(attempted).toMatchObject({ ok: false, error: 'REFUND_FAILED' });

  const stuck = await deps.repository.loadCashSale(sale.id);
  if (!stuck) throw new Error('setup: sale vanished');
  expect(stuck.refundStatus).toBe('FAILED');
  expect(stuck.refundCents).toBe(PARTIAL_REFUND_CENTS);
  return stuck;
}

describe('processDueCashSaleRefunds', () => {
  it('retries a refund that the provider refused, reusing the same nonce', async () => {
    const { deps, calls, paymentOptions } = makeDeps();
    const stuck = await saleWithStuckRefund(deps);

    const firstAttemptNonce = calls.refunds.at(-1)?.nonce;
    expect(firstAttemptNonce).toBeTruthy();

    // The provider recovers.
    paymentOptions.refundStatus = 'SETTLED';

    const pass = await processDueCashSaleRefunds(deps);

    expect(pass).toEqual({ considered: 1, settled: 1, stillOwed: 0 });

    const settled = await deps.repository.loadCashSale(stuck.id);
    expect(settled?.refundStatus).toBe('SETTLED');

    // THE PROPERTY THAT MAKES RETRYING SAFE. A fresh nonce would let the provider treat
    // this as a second, independent refund of the same collection.
    expect(calls.refunds).toHaveLength(2);
    expect(calls.refunds[1]?.nonce).toBe(firstAttemptNonce);
    expect(calls.refunds[1]?.amount).toBe(PARTIAL_REFUND_CENTS);
  });

  it('does not retry once the refund has settled', async () => {
    const { deps, calls, paymentOptions } = makeDeps();
    await saleWithStuckRefund(deps);
    paymentOptions.refundStatus = 'SETTLED';

    await processDueCashSaleRefunds(deps);
    const refundsAfterRecovery = calls.refunds.length;

    // A second pass must find nothing owed. Refunding again would spend the platform's
    // own money: the Buyer was only ever debited once.
    const second = await processDueCashSaleRefunds(deps);
    expect(second).toEqual({ considered: 0, settled: 0, stillOwed: 0 });
    expect(calls.refunds).toHaveLength(refundsAfterRecovery);
  });

  it('reports the refund as still owed when the provider refuses again', async () => {
    const { deps, calls } = makeDeps();
    const stuck = await saleWithStuckRefund(deps);

    // Provider still refusing.
    const pass = await processDueCashSaleRefunds(deps);

    expect(pass).toEqual({ considered: 1, settled: 0, stillOwed: 1 });
    const after = await deps.repository.loadCashSale(stuck.id);
    expect(after?.refundStatus).toBe('FAILED');
    // Attempted, and the attempt counted, so a permanently broken refund becomes visible
    // rather than retrying silently forever.
    expect(after?.refundAttempts).toBeGreaterThan(stuck.refundAttempts);
    expect(calls.refunds).toHaveLength(2);
  });

  it('stops retrying once the attempt budget is spent', async () => {
    const { deps } = makeDeps();
    await saleWithStuckRefund(deps);

    // One attempt has already been made by the resolution itself, so a budget of 1 is
    // already exhausted and the drain must leave the row for an operator.
    const pass = await processDueCashSaleRefunds(deps, { maxAttempts: 1 });
    expect(pass).toEqual({ considered: 0, settled: 0, stillOwed: 0 });
  });

  it('ignores a sale with nothing owed back', async () => {
    const { deps, calls } = makeDeps();
    // Disputed but never resolved, so no refund was ever queued.
    await disputedCashSale(deps);

    const pass = await processDueCashSaleRefunds(deps);

    expect(pass).toEqual({ considered: 0, settled: 0, stillOwed: 0 });
    expect(calls.refunds).toEqual([]);
  });

  it('never touches the seller release while chasing a refund', async () => {
    // The two drains spend money in opposite directions out of the same balance. A
    // refund pass that also released to the seller would pay out twice on one sale.
    const { deps, calls, paymentOptions } = makeDeps();
    await saleWithStuckRefund(deps);
    const payoutsBefore = calls.payouts.length;
    const transfersBefore = calls.transfers.length;

    paymentOptions.refundStatus = 'SETTLED';
    await processDueCashSaleRefunds(deps);

    expect(calls.payouts).toHaveLength(payoutsBefore);
    expect(calls.transfers).toHaveLength(transfersBefore);
  });
});
