// tests/unit/cashSaleTrackingClock.test.ts
//
// ESC-02 (Critical): a stale delivered tracking number used to start the buyer's
// inspection clock in the past, and the seller was paid about an hour later for goods
// never sent. The six cases from the design, against the orchestrator with a fake
// tracker.

import { settlementFor } from './helpers/settle';
import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  recordCashSaleShipment,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import type { TrackingService, TrackingSnapshot } from '@/domain/services/tracking/types';
import { BUYER, ITEM, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

const PAID_AT = '2026-10-10T00:00:00.000Z';
const NOW = '2026-10-12T00:00:00.000Z';

function trackerReturning(snapshot: Partial<TrackingSnapshot>): TrackingService {
  return {
    async registerShipment(input) {
      return {
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: null,
        status: 'IN_TRANSIT',
        ...snapshot,
      };
    },
  };
}

/** A DELIVERY sale paid at PAID_AT, waiting in ESCROW_HELD for its shipment. */
async function paidSale(tracking: TrackingService) {
  const { repository, state } = makeCashSaleRepository();
  const { payments } = makePayments();
  let clock = PAID_AT;
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking,
    now: () => new Date(clock),
  };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup: initiate');
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
  const settled = await repository.loadCashSale(created.sale.id);
  if (settled?.status !== 'ESCROW_HELD') throw new Error(`setup: expected ESCROW_HELD, got ${settled?.status}`);
  clock = NOW;
  return { deps, state, saleId: created.sale.id };
}

const ship = (deps: CashSaleOrchestratorDeps, saleId: string) =>
  recordCashSaleShipment(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    shipment: { carrier: 'Australia Post', trackingNumber: 'AP123456789AU' },
  });

describe('recordCashSaleShipment — the tracking clock (ESC-02)', () => {
  it('refuses a number whose first carrier scan predates payment, writing nothing', async () => {
    const { deps, state, saleId } = await paidSale(
      trackerReturning({ status: 'DELIVERED', deliveredAt: '2026-09-01T00:00:00.000Z', firstEventAt: '2026-08-28T00:00:00.000Z' }),
    );
    const result = await ship(deps, saleId);
    expect(result).toMatchObject({ ok: false, error: 'TRACKING_PREDATES_PAYMENT' });
    expect(state.sale?.status).toBe('ESCROW_HELD');
    expect(state.sale?.trackingNumber ?? null).toBeNull();
  });

  it('records a label created before payment when the first SCAN is after it', async () => {
    // `firstEventAt` already ignores info_received/pending; the scan is after payment.
    const { deps, saleId } = await paidSale(trackerReturning({ status: 'IN_TRANSIT', firstEventAt: '2026-10-11T00:00:00.000Z' }));
    const result = await ship(deps, saleId);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.flagged).toBeFalsy();
  });

  it('records when there are no events at all (no verdict, rule 1 does not apply)', async () => {
    const { deps, saleId } = await paidSale(trackerReturning({ status: 'LABEL_CREATED', firstEventAt: null }));
    expect(await ship(deps, saleId)).toMatchObject({ ok: true });
  });

  it('records when only a pre-scan event predates payment (firstEventAt null)', async () => {
    const { deps, saleId } = await paidSale(trackerReturning({ status: 'LABEL_CREATED', firstEventAt: null }));
    const result = await ship(deps, saleId);
    expect(result.ok && result.sale.status).toBe('IN_TRANSIT');
  });

  it('records and FLAGS a number already delivered at registration, with no inspection clock', async () => {
    const { deps, state, saleId } = await paidSale(
      trackerReturning({ status: 'DELIVERED', deliveredAt: '2026-10-11T12:00:00.000Z', firstEventAt: '2026-10-11T00:00:00.000Z' }),
    );
    const result = await ship(deps, saleId);
    expect(result).toMatchObject({ ok: true, flagged: true });
    expect(state.sale?.status).toBe('IN_TRANSIT');
    expect(state.sale?.trackingFlagReason).toBe('DELIVERED_AT_REGISTRATION');
    expect(state.sale?.inspectionDeadlineAt ?? null).toBeNull();
    expect(state.events.map((e) => e.event)).toContain('TRACKING_FLAGGED');
  });

  it('records an in-transit number normally, unflagged', async () => {
    const { deps, state, saleId } = await paidSale(trackerReturning({ status: 'IN_TRANSIT', firstEventAt: '2026-10-11T00:00:00.000Z' }));
    await ship(deps, saleId);
    expect(state.sale?.status).toBe('IN_TRANSIT');
    expect(state.sale?.trackingFlaggedAt ?? null).toBeNull();
  });
});
