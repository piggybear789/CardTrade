// tests/unit/cashSaleDisputeWithdrawal.test.ts
//
// Ending a disputed Cash_Sale WITHOUT an arbitrator (0084).
//
// There are two ways, and the whole safety argument is that a party may only ever act
// against their own interest:
//
//   WITHDRAW   the raiser drops their own claim. No money moves on any path.
//   SETTLE     the party CONCEDES — a Buyer releases the payment to the Seller, or a
//              Seller refunds the Buyer in full.
//
// WHY THESE TESTS EXIST AT ALL. A participant-callable resolution used to exist on the
// trade surface and was deleted because it captured money FROM the counterparty: either
// trader could decide their own case in their own favour. Reintroducing anything
// participant-callable in a money path is therefore only defensible while the
// "concede, never decide" rule holds, so the rule needs tests that fail loudly if it is
// ever loosened.
//
// The properties worth protecting, in order of what a regression costs:
//
//   1. A Buyer cannot award themselves a refund, and a Seller cannot release their own
//      payment. Either would be a party taking money from the other with no review.
//   2. Only the raiser can withdraw. If the accused could, they would be dismissing a
//      claim against themselves.
//   3. A decided dispute cannot be withdrawn or re-settled. The decision stands.
//   4. A withdrawal restores the status the contract actually came from, and moves no
//      money.

import { describe, expect, it } from 'vitest';

import {
  resolveCashSaleDispute,
  settleCashSaleDisputeAsParty,
  withdrawCashSaleDispute,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import {
  BUYER,
  ITEM,
  fakeTracking,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';

const SELLER = ITEM.ownerId;
const STRANGER = 'stranger-1';
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

// The shared helper disputes as the BUYER out of INSPECTION, so INSPECTION is the
// status a withdrawal must restore.
describe('withdrawCashSaleDispute', () => {
  it('returns the contract to the status it was disputed from and clears the claim', async () => {
    const { deps, state } = makeDeps();
    const sale = await disputedCashSale(deps);
    expect(sale.status).toBe('DISPUTED');

    const result = await withdrawCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('INSPECTION');
    // Genuinely undisputed again, not merely flagged as resolved.
    expect(result.sale.disputedBy).toBeNull();
    expect(result.sale.disputeResolution).toBeNull();
    expect(state.events.map((e) => e.event)).toContain('DISPUTE_WITHDRAWN');
  });

  it('moves no money', async () => {
    const { deps, calls } = makeDeps();
    const sale = await disputedCashSale(deps);

    await withdrawCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
    });

    // Nothing was captured when the dispute was raised, so there is nothing to undo.
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(0);
  });

  it('refuses the accused party — dismissing a claim against yourself is deciding it', async () => {
    const { deps, state } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await withdrawCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PERMITTED');
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.status).toBe('DISPUTED');
    expect(state.events.map((e) => e.event)).not.toContain('DISPUTE_WITHDRAWN');
  });

  it('refuses a non-participant', async () => {
    const { deps } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await withdrawCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: STRANGER,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PARTICIPANT');
  });

  it('refuses once an operator has decided, so the decision stands', async () => {
    const { deps } = makeDeps();
    const sale = await disputedCashSale(deps);
    const decided = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });
    expect(decided.ok).toBe(true);

    const result = await withdrawCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_STATE');
  });
});

describe('settleCashSaleDisputeAsParty', () => {
  it('lets the buyer release the payment to the seller', async () => {
    const { deps, calls, state } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('COMPLETED');
    // Nothing refunded, and the seller is paid through the ordinary release path.
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(1);
    // Recorded as a party settlement, not as an arbitration outcome.
    expect(state.events.map((e) => e.event)).toContain('DISPUTE_SETTLED_BY_PARTY');
    expect(result.sale.disputeResolvedBy ?? null).toBe(BUYER.profileId);
  });

  // A Seller conceding a full refund goes through the RETURN flow too (0088), and
  // that is in their favour: conceding the money no longer means writing off the item
  // as well. The concession is still real and still irreversible — they cannot undo
  // it — it just no longer hands over both the goods and the cash.
  it('lets the seller concede a full refund, which waits on the return', async () => {
    const { deps, calls, state } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      outcome: 'REFUND_BUYER',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('RETURN_PENDING');
    expect(result.sale.returnDeadlineAt).toBeTruthy();
    // Money waits for the goods, so no refund has been attempted yet.
    expect(calls.refunds).toHaveLength(0);
    // The seller gave up the sale, so nothing is released to them either.
    expect(calls.payouts).toHaveLength(0);
    expect(state.events.map((e) => e.event)).toContain('DISPUTE_SETTLED_BY_PARTY');
  });

  it('refuses a buyer awarding themselves a refund', async () => {
    const { deps, calls } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      outcome: 'REFUND_BUYER',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PERMITTED');
    // The refusal must happen BEFORE the payment seam is touched.
    expect(calls.refunds).toHaveLength(0);
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.status).toBe('DISPUTED');
  });

  it('refuses a seller releasing their own payment', async () => {
    const { deps, calls } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PERMITTED');
    expect(calls.payouts).toHaveLength(0);
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.status).toBe('DISPUTED');
  });

  it('refuses a non-participant', async () => {
    const { deps, calls } = makeDeps();
    const sale = await disputedCashSale(deps);

    const result = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: STRANGER,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PARTICIPANT');
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(0);
  });

  it('refuses once already settled, so a double submit cannot settle twice', async () => {
    const { deps, calls } = makeDeps();
    const sale = await disputedCashSale(deps);

    const first = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      outcome: 'REFUND_BUYER',
    });
    expect(first.ok).toBe(true);

    const second = await settleCashSaleDisputeAsParty(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      outcome: 'REFUND_BUYER',
    });

    expect(second.ok).toBe(false);
    // The concession stands from the FIRST call and the second changes nothing.
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.status).toBe('RETURN_PENDING');
    expect(current?.disputeResolution).toBe('REFUND_BUYER');
    // Asserts zero, not one, and that is the point post-0088: this outcome now waits
    // for the returned goods, so NO refund has been attempted at this stage by either
    // call. The double-submit protection being tested is that the second call cannot
    // re-resolve — previously observable as "only one refund", and now as "the state
    // did not move and no payment was attempted at all".
    expect(calls.refunds).toHaveLength(0);
  });
});
