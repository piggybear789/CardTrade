// tests/unit/cashSaleReturnLapse.test.ts
//
// The lapse policy (0089), which is the highest-risk decision in the return flow.
//
// WHY THIS FILE EXISTS SEPARATELY. Everything else in the return flow fails safe by
// construction: a missing carrier confirmation simply means nothing happens. The lapse
// is the one place where TIME PASSING is the trigger, and the tempting implementation —
// release the money to the seller once the buyer misses the deadline — would reverse an
// operator's finding automatically, with nobody looking at it.
//
// These tests pin the refusal rather than the mechanism, because the mechanism may
// reasonably change and the refusal may not.

import { describe, expect, it } from 'vitest';

import {
  finalizeReturnedCashSale,
  resolveCashSaleDispute,
  RETURN_DISPATCH_DAYS,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  fakeTracking,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';
import type { PaymentService } from '@/domain/services/types';

const OPERATOR = 'admin-1';

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

describe('a return whose deadline has passed', () => {
  /** Enter the return flow, then wind the deadline into the past. */
  async function lapsed(deps: CashSaleOrchestratorDeps) {
    const sale = await disputedCashSale(deps);
    const resolved = await resolveCashSaleDispute(deps, {
      cashSaleId: sale.id,
      actorId: OPERATOR,
      outcome: 'REFUND_BUYER',
    });
    if (!resolved.ok) throw new Error('setup: could not enter the return flow');

    const current = await deps.repository.loadCashSale(sale.id);
    if (!current) throw new Error('setup: sale vanished');
    // A day past the dispatch deadline, with nothing posted.
    Object.assign(current, {
      returnDeadlineAt: new Date(
        Date.now() - (RETURN_DISPATCH_DAYS + 1) * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    return current;
  }

  // THE CENTRAL GUARANTEE. If this ever passes money to the seller, the platform has
  // overturned a decided dispute on a timer.
  it('never releases the money to the seller', async () => {
    const { deps, calls } = makeDeps();
    const sale = await lapsed(deps);

    // Nothing in the orchestrator should move this sale on. The sweep's job is to
    // FLAG it, and flagging is not settling.
    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(false);
    expect(calls.payouts).toHaveLength(0);
    expect(calls.refunds).toHaveLength(0);
  });

  it('does not cancel the refund either — the finding still stands', async () => {
    const { deps } = makeDeps();
    const sale = await lapsed(deps);

    const current = await deps.repository.loadCashSale(sale.id);
    // Still RETURN_PENDING, and still resolved in the buyer's favour. A lapse is not
    // a reversal: the operator found for the buyer on the merits and a missed postage
    // deadline is not evidence against that.
    expect(current?.status).toBe('RETURN_PENDING');
    expect(current?.disputeResolution).toBe('REFUND_BUYER');
  });

  it('still closes normally if the buyer posts late and it arrives', async () => {
    const { deps, state } = makeDeps();
    const sale = await lapsed(deps);

    // A late return is still a return. Nothing about the lapse should have poisoned
    // the path — otherwise flagging the case would quietly become a punishment.
    const posted = await deps.repository.recordReturnShipment({
      cashSaleId: sale.id,
      carrier: 'Australia Post',
      trackingNumber: 'LATE123',
      trackingUrl: null,
      trackingStatus: null,
      shippedAt: new Date().toISOString(),
    });
    expect(posted).not.toBeNull();

    const current = await deps.repository.loadCashSale(sale.id);
    Object.assign(current!, { returnCarrierDeliveredAt: new Date().toISOString() });

    const result = await finalizeReturnedCashSale(deps, { cashSaleId: sale.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sale.status).toBe('REFUNDED');
    expect(state.item.status).toBe('AVAILABLE');
  });
});
