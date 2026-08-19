// tests/unit/cashSaleReturnFlow.test.ts
//
// Return-conditional refunds (0088). See `.kiro/specs/return-refunds/requirements.md`.
//
// WHAT THESE PIN. The flow's whole value is an ORDERING guarantee — goods move before
// money — plus the fact that neither side can shortcut it:
//
//   * a full refund on goods the Buyer holds does not pay out or relist immediately
//   * only the Buyer can post the return, and only once
//   * only a CARRIER confirmation closes it, never a party's assertion
//   * a Seller contesting the return freezes the automatic close
//   * closing twice is impossible
//
// The derivation is tested separately from the override, because "the system noticed
// the goods had arrived" and "an operator said so" are different guarantees and only
// the first protects a Seller who is not paying attention.

import { describe, expect, it } from 'vitest';

import {
  disputeCashSaleReturn,
  finalizeReturnedCashSale,
  recordCashSaleReturnShipment,
  resolveCashSaleDispute,
  resolveCashSaleReturnCase,
  returnRequiredForRefund,
  RETURN_DISPATCH_DAYS,
  type CashSaleOrchestratorDeps,
  type CashSaleRecord,
  type ReturnRequiredFacts,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  BUYER,
  ITEM,
  fakeTracking,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';
import type { PaymentService } from '@/domain/services/types';

const OPERATOR = 'admin-1';
const SELLER = ITEM.ownerId;
const STRANGER = 'stranger-1';

function makeDeps() {
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments({});
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  return { deps, state, calls };
}

/** Drive a disputed sale into RETURN_PENDING via a full-refund resolution. */
async function returnPending(deps: CashSaleOrchestratorDeps): Promise<CashSaleRecord> {
  const sale = await disputedCashSale(deps);
  const resolved = await resolveCashSaleDispute(deps, {
    cashSaleId: sale.id,
    actorId: OPERATOR,
    outcome: 'REFUND_BUYER',
  });
  if (!resolved.ok) throw new Error('setup: could not enter the return flow');
  return resolved.sale;
}

describe('returnRequiredForRefund', () => {
  // Each of these is a different way the record says "the buyer has it", and they
  // matter separately because they come from different fulfilment paths: a carrier
  // confirmation and an in-person buyer handover never both appear on one sale.
  //
  // No cast: `returnRequiredForRefund` takes exactly these five fields, so the test
  // states its input honestly rather than pretending to hold a whole sale.
  const base: ReturnRequiredFacts = {
    carrierDeliveredAt: null,
    receivedAt: null,
    inspectionAcceptedAt: null,
    buyerHandoverConfirmedAt: null,
    sellerHandoverConfirmedAt: null,
  };

  it('requires a return once a carrier confirmed delivery', () => {
    expect(returnRequiredForRefund({ ...base, carrierDeliveredAt: 'x' })).toBe(true);
  });

  it('requires a return once the buyer confirmed receipt', () => {
    expect(returnRequiredForRefund({ ...base, receivedAt: 'x' })).toBe(true);
  });

  it('requires a return once the buyer accepted at inspection', () => {
    expect(returnRequiredForRefund({ ...base, inspectionAcceptedAt: 'x' })).toBe(true);
  });

  it('requires a return once the buyer confirmed an in-person handover', () => {
    expect(returnRequiredForRefund({ ...base, buyerHandoverConfirmedAt: 'x' })).toBe(true);
  });

  it('requires a return once the seller confirmed an in-person handover', () => {
    expect(returnRequiredForRefund({ ...base, sellerHandoverConfirmedAt: 'x' })).toBe(true);
  });

  // The lost-parcel and never-shipped cases. There is nothing to send back, so
  // demanding a return would strand the buyer's money indefinitely.
  it('requires no return when nothing shows the goods arrived', () => {
    expect(returnRequiredForRefund(base)).toBe(false);
  });
});

describe('entering the return flow', () => {
  it('moves no money and does not relist', async () => {
    const { deps, state, calls } = makeDeps();
    const sale = await returnPending(deps);

    expect(sale.status).toBe('RETURN_PENDING');
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(0);
    // Relisting here would advertise goods that are about to be in transit.
    expect(state.item.status).not.toBe('AVAILABLE');
  });

  it('sets a dispatch deadline the sweep can act on', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    expect(sale.returnDeadlineAt).toBeTruthy();
    const days =
      (new Date(sale.returnDeadlineAt as string).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    // Within a day of the configured window, allowing for clock drift in the fake.
    expect(Math.abs(days - RETURN_DISPATCH_DAYS)).toBeLessThan(1);
  });
});

describe('recordCashSaleReturnShipment', () => {
  it('lets the buyer post the return and registers it for tracking', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    const result = await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: 'Australia Post',
      trackingNumber: 'RET123456789AU',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('RETURN_IN_TRANSIT');
    expect(result.sale.returnTrackingNumber).toBe('RET123456789AU');
    expect(result.sale.returnShippedAt).toBeTruthy();
    // The OUTBOUND leg must survive untouched — arbitration reads both.
    expect(result.sale.trackingNumber).toBe('AP123456789AU');
  });

  it('refuses the seller and a stranger — the buyer is the one posting', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    for (const actorId of [SELLER, STRANGER]) {
      const result = await recordCashSaleReturnShipment(deps, {
        cashSaleId: sale.id,
        actorId,
        carrier: 'Australia Post',
        trackingNumber: 'RET1',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('NOT_PERMITTED');
    }
  });

  it('refuses a second submission, so the recorded carrier cannot be replaced', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: 'Australia Post',
      trackingNumber: 'FIRST123',
    });
    const second = await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: 'Sendle',
      trackingNumber: 'SECOND456',
    });

    expect(second.ok).toBe(false);
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.returnTrackingNumber).toBe('FIRST123');
  });

  it('requires a carrier and a plausible tracking number', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    const result = await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: '',
      trackingNumber: 'X',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_TERMS');
  });
});

describe('finalizeReturnedCashSale', () => {
  /** Post the return and stamp the carrier confirmation the SQL function would set. */
  async function inTransitAndDelivered(deps: CashSaleOrchestratorDeps, saleId: string) {
    await recordCashSaleReturnShipment(deps, {
      cashSaleId: saleId,
      actorId: BUYER.profileId,
      carrier: 'Australia Post',
      trackingNumber: 'RET123',
    });
    const sale = await deps.repository.loadCashSale(saleId);
    if (!sale) throw new Error('setup: sale vanished');
    // `apply_cash_sale_return_tracking` is what sets this in production; the fake has
    // no carrier, so the test stamps it directly.
    Object.assign(sale, { returnCarrierDeliveredAt: new Date().toISOString() });
    return sale;
  }

  it('refuses to close without a carrier confirmation', async () => {
    const { deps, state } = makeDeps();
    const sale = await returnPending(deps);
    await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: 'Australia Post',
      trackingNumber: 'RET123',
    });

    // In transit, but no carrier has confirmed anything.
    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_STATE');
    expect(state.item.status).not.toBe('AVAILABLE');
  });

  it('closes the sale REFUNDED and relists only on carrier confirmation', async () => {
    const { deps, state } = makeDeps();
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('REFUNDED');
    // THE ONLY POINT AT WHICH THE ITEM COMES BACK: the seller demonstrably has it.
    expect(state.item.status).toBe('AVAILABLE');
  });

  // THE TEST THAT WAS MISSING, AND THE BUG IT WOULD HAVE CAUGHT.
  //
  // Every other test here asserts STATUS. This asserts MONEY. The first version of
  // this flow set REFUNDED, relisted the item, and never paid anyone: the refund was
  // queued by a stored procedure guarded on `status = 'DISPUTED'`, which matches
  // nothing from a return state. Twenty-one status assertions passed against a buyer
  // who posted their goods back and got nothing.
  //
  // Assert the payment, not the paperwork.
  it('actually refunds the buyer — not just marks the sale REFUNDED', async () => {
    const { deps, calls } = makeDeps();
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(true);
    // The money moved, for the full amount, exactly once.
    expect(calls.refunds).toHaveLength(1);
    expect(calls.refunds[0].amount).toBe(sale.amountCents);
    // And it is recorded as settled, so reconciliation can see it landed.
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.refundStatus).toBe('SETTLED');
    expect(current?.refundNonce).toBeTruthy();
  });

  it('does not pay twice when a duplicate carrier event arrives', async () => {
    const { deps, calls } = makeDeps();
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });
    await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    // One refund, two events. The provider nonce would also deduplicate, but relying
    // on that alone means shipping a double-spend and trusting Stripe to catch it.
    expect(calls.refunds).toHaveLength(1);
  });

  it('leaves the sale open and unlisted when the provider rejects the refund', async () => {
    const { repository, state } = makeCashSaleRepository();
    const { payments, calls } = makePayments({ refundStatus: 'FAILED' });
    const deps: CashSaleOrchestratorDeps = {
      repository,
      payments: payments as unknown as PaymentService,
      tracking: fakeTracking,
    };
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('REFUND_FAILED');
    expect(calls.refunds).toHaveLength(1);
    // NOT REFUNDED and NOT RELISTED. Claiming either while the buyer has no money is
    // the failure this ordering exists to prevent; the drain retries instead.
    const current = await deps.repository.loadCashSale(sale.id);
    expect(current?.status).toBe('RETURN_IN_TRANSIT');
    expect(current?.refundStatus).toBe('FAILED');
    expect(state.item.status).not.toBe('AVAILABLE');
  });

  it('is idempotent, so a duplicate carrier event cannot close it twice', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    const first = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });
    const second = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(first.ok).toBe(true);
    // Already REFUNDED reports success rather than an error: a repeated webhook is
    // not a fault, and a 500 back to the provider would make it retry forever.
    expect(second.ok).toBe(true);
  });

  it('will not close a return the seller has contested', async () => {
    const { deps, state } = makeDeps();
    const sale = await returnPending(deps);
    await inTransitAndDelivered(deps, sale.id);

    const contested = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      reason: 'The box arrived empty — there was no card inside it.',
    });
    expect(contested.ok).toBe(true);

    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(false);
    // Frozen for an operator: nothing refunded, nothing relisted.
    expect(state.item.status).not.toBe('AVAILABLE');
  });
});

describe('resolveCashSaleReturnCase', () => {
  /** A return the seller has contested — the state that had no way out. */
  async function contested(deps: CashSaleOrchestratorDeps) {
    const sale = await returnPending(deps);
    await recordCashSaleReturnShipment(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      carrier: 'Australia Post',
      trackingNumber: 'RET1',
    });
    const contestResult = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      reason: 'The parcel arrived with nothing inside it.',
    });
    if (!contestResult.ok) throw new Error('setup: could not contest');
    return sale;
  }

  it('refuses a return that is running normally — only stalled cases need staff', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    const result = await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_STATE');
  });

  it('can refund the buyer on a contested return', async () => {
    const { deps, calls } = makeDeps();
    const sale = await contested(deps);

    const result = await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('REFUNDED');
    expect(calls.refunds).toHaveLength(1);
  });

  // The listing must not reappear on an operator's word alone. Relisting goods the
  // seller may not have is what migration 0064 exists to prevent.
  it('does not relist when no carrier confirmed the goods arrived', async () => {
    const { deps, state } = makeDeps();
    const sale = await contested(deps);

    await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });

    expect(state.item.status).not.toBe('AVAILABLE');
  });

  it('can release to the seller, and pays them through the ordinary path', async () => {
    const { deps, calls } = makeDeps();
    const sale = await contested(deps);

    const result = await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(true);
    // The buyer keeps the goods, so the item is SOLD rather than relisted.
    expect(calls.refunds).toHaveLength(0);
    // Released through payoutCashSaleSeller, which is what keeps canReceiveFunds and
    // the fraud-ban check in the path rather than around it.
    expect(calls.payouts).toHaveLength(1);
  });

  // DOUBLE-PAYMENT PROTECTION. The narrow race this closes: a carrier confirmation
  // queues the refund, the seller contests moments later, the hourly drain settles the
  // refund anyway, and staff then release to the seller — paying both sides in full out
  // of one collection. Two independent guards now stop it, and this pins the second.
  it('refuses to release to the seller once the buyer has been refunded', async () => {
    const { deps, calls } = makeDeps();
    const sale = await contested(deps);

    // Simulate the drain having settled the refund while the case was contested.
    await deps.repository.recordRefundResult({
      cashSaleId: sale.id,
      status: 'SETTLED',
      refundId: 'refund-already-gone',
    });

    const result = await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_STATE');
    // THE ASSERTION THAT MATTERS: nobody was paid a second time.
    expect(calls.payouts).toHaveLength(0);
  });

  it('cannot be resolved twice', async () => {
    const { deps, calls } = makeDeps();
    const sale = await contested(deps);

    await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });
    const second = await resolveCashSaleReturnCase(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'RELEASE_SELLER',
    });

    expect(second.ok).toBe(false);
    // AND CRUCIALLY: the second call, asking for the OPPOSITE outcome, paid nobody.
    expect(calls.refunds).toHaveLength(1);
    expect(calls.payouts).toHaveLength(0);
  });
});

describe('disputeCashSaleReturn', () => {
  it('captures and releases nothing by itself', async () => {
    const { deps, calls } = makeDeps();
    const sale = await returnPending(deps);

    const result = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      reason: 'Tracking says delivered but nothing has arrived here.',
    });

    expect(result.ok).toBe(true);
    // Following HANDOVER_FAILED on the trade side: a contested return has not been
    // shown to be anyone's fault, so it moves no money in either direction.
    expect(calls.refunds).toHaveLength(0);
    expect(calls.payouts).toHaveLength(0);
  });

  it('refuses the buyer — they cannot contest their own return', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    const result = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: BUYER.profileId,
      reason: 'Some plausible sounding reason goes here.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_PERMITTED');
  });

  it('demands an actual account of the problem', async () => {
    const { deps } = makeDeps();
    const sale = await returnPending(deps);

    const result = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: SELLER,
      reason: 'bad',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_TERMS');
  });
});
