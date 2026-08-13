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
  returnRequiredForRefund,
  RETURN_DISPATCH_DAYS,
  type CashSaleOrchestratorDeps,
  type CashSaleRecord,
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
  // confirmation and a mutual handover never both appear on one sale.
  const base = {
    carrierDeliveredAt: null,
    receivedAt: null,
    inspectionAcceptedAt: null,
    buyerHandoverConfirmedAt: null,
    sellerHandoverConfirmedAt: null,
  } as unknown as CashSaleRecord;

  it('requires a return once a carrier confirmed delivery', () => {
    expect(returnRequiredForRefund({ ...base, carrierDeliveredAt: 'x' })).toBe(true);
  });

  it('requires a return once the buyer confirmed receipt', () => {
    expect(returnRequiredForRefund({ ...base, receivedAt: 'x' })).toBe(true);
  });

  it('requires a return once the buyer accepted at inspection', () => {
    expect(returnRequiredForRefund({ ...base, inspectionAcceptedAt: 'x' })).toBe(true);
  });

  it('requires a return only when BOTH parties confirmed an in-person handover', () => {
    expect(returnRequiredForRefund({ ...base, buyerHandoverConfirmedAt: 'x' })).toBe(false);
    expect(
      returnRequiredForRefund({
        ...base,
        buyerHandoverConfirmedAt: 'x',
        sellerHandoverConfirmedAt: 'x',
      }),
    ).toBe(true);
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
