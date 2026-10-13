// tests/unit/resolveTrackingFlag.test.ts
//
// ESC-02: the staff exit from a tracking flag. START_CLOCK opens the buyer's
// inspection from NOW; REFUND_BUYER refunds in full with nothing to return. Both are
// guarded on an open flag, and while the flag is open no tracking update advances the
// sale.

import { settlementFor } from './helpers/settle';
import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  recordCashSaleShipment,
  resolveTrackingFlag,
  settleCashSale,
  syncCashSaleTracking,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import type { TrackingService } from '@/domain/services/tracking/types';
import { BUYER, ITEM, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

const STAFF = 'staff-1';
const PAID_AT = '2026-10-10T00:00:00.000Z';
const NOW = '2026-10-12T00:00:00.000Z';
const DAY = 86_400_000;

const deliveredTracker: TrackingService = {
  async registerShipment(input) {
    return {
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: null,
      status: 'DELIVERED',
      deliveredAt: '2026-10-11T12:00:00.000Z',
      firstEventAt: '2026-10-11T00:00:00.000Z',
    };
  },
  async fetchStatus(input) {
    return {
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: null,
      status: 'DELIVERED',
      deliveredAt: new Date().toISOString(),
    };
  },
};

/** A sale flagged DELIVERED_AT_REGISTRATION. */
async function flaggedSale() {
  const { repository, state } = makeCashSaleRepository();
  const { payments, calls } = makePayments();
  // Paid at PAID_AT; the tracker's first scan (10-11) is after payment.
  let clock = PAID_AT;
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: deliveredTracker,
    now: () => new Date(clock),
  };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup');
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: price');
  await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  const sale = await repository.loadCashSale(created.sale.id);
  await acceptCashSaleTerms(deps, { cashSaleId: created.sale.id, actorId: BUYER.profileId, termsVersion: sale!.termsVersion });
  await settleCashSale(deps, await settlementFor(deps, created.sale.id));
  clock = NOW;
  const shipped = await recordCashSaleShipment(deps, {
    cashSaleId: created.sale.id,
    actorId: ITEM.ownerId,
    shipment: { carrier: 'Australia Post', trackingNumber: 'AP1' },
  });
  if (!shipped.ok || !shipped.flagged) throw new Error(`setup: expected a flag, got ${JSON.stringify(shipped)}`);
  return { deps, state, calls, saleId: created.sale.id };
}

describe('resolveTrackingFlag', () => {
  it('START_CLOCK opens the inspection from now', async () => {
    const { deps, state, saleId } = await flaggedSale();
    const before = Date.parse(NOW);
    const result = await resolveTrackingFlag(deps, { cashSaleId: saleId, staffId: STAFF, decision: 'START_CLOCK', inspectionDays: 7 });
    expect(result).toMatchObject({ ok: true });
    expect(state.sale?.status).toBe('INSPECTION');
    const deadline = Date.parse(state.sale!.inspectionDeadlineAt!);
    expect(deadline).toBeGreaterThanOrEqual(before + 7 * DAY - 1_000);
    expect(state.sale?.trackingFlagResolvedAt).toBeTruthy();
  });

  it('REFUND_BUYER refunds in full with no return required', async () => {
    const { deps, state, calls, saleId } = await flaggedSale();
    const result = await resolveTrackingFlag(deps, { cashSaleId: saleId, staffId: STAFF, decision: 'REFUND_BUYER', inspectionDays: 7 });
    expect(result).toMatchObject({ ok: true });
    expect(state.sale?.status).not.toBe('RETURN_PENDING');
    expect(JSON.stringify(calls)).toMatch(/refund/i);
  });

  it('refuses once the flag is already resolved', async () => {
    const { deps, saleId } = await flaggedSale();
    await resolveTrackingFlag(deps, { cashSaleId: saleId, staffId: STAFF, decision: 'START_CLOCK', inspectionDays: 7 });
    const again = await resolveTrackingFlag(deps, { cashSaleId: saleId, staffId: STAFF, decision: 'REFUND_BUYER', inspectionDays: 7 });
    expect(again).toMatchObject({ ok: false, error: 'INVALID_STATE' });
  });

  it('a later tracking update while flagged does not advance the sale', async () => {
    const { deps, state, saleId } = await flaggedSale();
    await syncCashSaleTracking(deps, { cashSaleId: saleId, actorId: BUYER.profileId });
    expect(state.sale?.status).toBe('IN_TRANSIT');
    expect(state.sale?.inspectionDeadlineAt ?? null).toBeNull();
  });
});
