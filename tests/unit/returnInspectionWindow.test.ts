// tests/unit/returnInspectionWindow.test.ts
//
// ESC-11: carrier delivery of a return opens the seller's 72-hour window to check the
// parcel. The refund is released only after it closes uncontested, by the `:47` job
// through `releaseDueReturnRefunds`. ESC-38: that release uses the sale's own region.

import { describe, expect, it } from 'vitest';

import {
  RETURN_INSPECTION_HOURS,
  RETURN_INSPECTION_LABEL,
  returnInspectionDeadline,
  returnInspectionOpen,
  returnRefundDue,
} from '@/domain/fulfilment/inspection';
import {
  disputeCashSaleReturn,
  recordCashSaleReturnShipment,
  releaseDueReturnRefunds,
  resolveCashSaleDispute,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-13T10:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

describe('return inspection window (pure)', () => {
  it('is three days, and the label says so', () => {
    expect(RETURN_INSPECTION_HOURS).toBe(72);
    expect(RETURN_INSPECTION_LABEL).toBe('3 days');
  });

  it('prefers the stored deadline and derives one for pre-0143 deliveries', () => {
    const stored = { status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: ago(10), returnInspectionDeadlineAt: ago(-5) };
    expect(returnInspectionDeadline(stored)).toBe(ago(-5));
    const legacy = { status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: ago(10) };
    expect(returnInspectionDeadline(legacy)).toBe(ago(10 - 72));
    expect(returnInspectionDeadline({ status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: null })).toBeNull();
  });

  it('is open before delivery and for 72h after, then closed', () => {
    expect(returnInspectionOpen({ status: 'RETURN_PENDING', returnCarrierDeliveredAt: null }, NOW)).toBe(true);
    expect(returnInspectionOpen({ status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: null }, NOW)).toBe(true);
    expect(returnInspectionOpen({ status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: ago(71) }, NOW)).toBe(true);
    expect(returnInspectionOpen({ status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: ago(73) }, NOW)).toBe(false);
    expect(returnInspectionOpen({ status: 'REFUNDED', returnCarrierDeliveredAt: ago(1) }, NOW)).toBe(false);
  });

  it('makes the refund due only once the window closed and nothing was contested', () => {
    const base = { status: 'RETURN_IN_TRANSIT', returnCarrierDeliveredAt: ago(73) };
    expect(returnRefundDue(base, NOW)).toBe(true);
    expect(returnRefundDue({ ...base, returnCarrierDeliveredAt: ago(1) }, NOW)).toBe(false);
    expect(returnRefundDue({ ...base, returnDisputedAt: ago(2) }, NOW)).toBe(false);
    expect(returnRefundDue({ ...base, returnCarrierDeliveredAt: null }, NOW)).toBe(false);
  });
});

function makeDeps() {
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments({});
  const due: string[] = [];
  const deps: CashSaleOrchestratorDeps = {
    repository: { ...repository, listDueReturnRefunds: async () => [...due] },
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    now: () => NOW,
  };
  return { deps, state, calls, due };
}

async function deliveredReturn(deps: CashSaleOrchestratorDeps, hoursAgo: number) {
  const sale = await disputedCashSale(deps);
  const resolved = await resolveCashSaleDispute(deps, {
    cashSaleId: sale.id,
    actorId: 'admin-1',
    outcome: 'REFUND_BUYER',
  });
  if (!resolved.ok) throw new Error('setup: no return flow');
  await recordCashSaleReturnShipment(deps, {
    cashSaleId: sale.id,
    actorId: BUYER.profileId,
    carrier: 'Australia Post',
    trackingNumber: 'RET777',
  });
  const current = await deps.repository.loadCashSale(sale.id);
  Object.assign(current!, {
    returnCarrierDeliveredAt: ago(hoursAgo),
    returnInspectionDeadlineAt: ago(hoursAgo - RETURN_INSPECTION_HOURS),
  });
  return current!;
}

describe('disputeCashSaleReturn inside the window', () => {
  it('lets the seller contest while the window is open', async () => {
    const { deps } = makeDeps();
    const sale = await deliveredReturn(deps, 10);
    const result = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: ITEM.ownerId,
      reason: 'The parcel was empty when it arrived.',
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a contest once the window has closed', async () => {
    const { deps } = makeDeps();
    const sale = await deliveredReturn(deps, 80);
    const result = await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: ITEM.ownerId,
      reason: 'The parcel was empty when it arrived.',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('RETURN_WINDOW_CLOSED');
  });
});

describe('releaseDueReturnRefunds', () => {
  it('refunds a closed window through the sale\'s own binding (ESC-38)', async () => {
    const { deps, calls, due, state } = makeDeps();
    const sale = await deliveredReturn(deps, 80);
    due.push(sale.id);

    const asked: string[] = [];
    const summary = await releaseDueReturnRefunds(deps, {
      paymentsFor: async (cashSaleId) => {
        asked.push(cashSaleId);
        return deps.payments;
      },
    });

    expect(asked).toEqual([sale.id]);
    expect(summary.refunded).toEqual([sale.id]);
    expect(calls.refunds).toHaveLength(1);
    expect(state.item.status).toBe('AVAILABLE');
  });

  it('skips a sale whose window is still open even if listed', async () => {
    const { deps, calls, due } = makeDeps();
    const sale = await deliveredReturn(deps, 5);
    due.push(sale.id);

    const summary = await releaseDueReturnRefunds(deps);

    expect(summary.refunded).toEqual([]);
    expect(summary.failed[0]?.error).toBe('RETURN_INSPECTION_OPEN');
    expect(calls.refunds).toHaveLength(0);
  });

  it('never refunds a contested return', async () => {
    const { deps, calls, due } = makeDeps();
    const sale = await deliveredReturn(deps, 10);
    await disputeCashSaleReturn(deps, {
      cashSaleId: sale.id,
      actorId: ITEM.ownerId,
      reason: 'A different card arrived in the return.',
    });
    // Contested inside the window; the window then closes.
    Object.assign((await deps.repository.loadCashSale(sale.id))!, {
      returnInspectionDeadlineAt: ago(1),
    });
    due.push(sale.id);

    await releaseDueReturnRefunds(deps);

    expect(calls.refunds).toHaveLength(0);
  });

  it('does nothing when the repository cannot list due returns', async () => {
    const { repository } = makeCashSaleRepository();
    const { payments } = makePayments({});
    const summary = await releaseDueReturnRefunds({
      repository,
      payments: payments as unknown as PaymentService,
    });
    expect(summary).toEqual({ examined: 0, refunded: [], failed: [] });
  });
});
