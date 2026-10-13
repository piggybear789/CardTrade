// tests/unit/cashSalePayoutHoldback.test.ts
//
// ESC-03 (Critical): money left the platform faster than card fraud can be detected.
// The seller payout now asks the one release policy first: a NEW seller waits out the
// holdback from collection, an open chargeback holds it outright, an established seller
// is paid at once. A deferral spends no attempt and is not a drain failure.

import { describe, expect, it, vi } from 'vitest';

import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  initiateCashSale,
  processDueCashSalePayouts,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import type { ReleaseFacts } from '@/domain/payouts/releasePolicy';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return {
    source: 'CASH_SALE',
    currency: 'aud',
    qualifyingCompletedSales: 0,
    paymentSettledAt: new Date().toISOString(),
    openChargeDispute: false,
    openFraudWarning: false,
    staffHold: false,
    ...overrides,
  };
}

async function completeWith(release: ReleaseFacts) {
  const { repository } = makeCashSaleRepository();
  const { payments, calls } = makePayments();
  const deferrals: unknown[] = [];
  const deps: CashSaleOrchestratorDeps = {
    repository: {
      ...repository,
      loadReleaseFacts: async () => release,
      recordPayoutDeferral: async (p) => {
        deferrals.push(p);
      },
    },
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup');
  const id = created.sale.id;
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: price');
  await updateCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, expectedTermsVersion: priced.sale.termsVersion, terms: DELIVERY_TERMS });
  const sale = await deps.repository.loadCashSale(id);
  await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion: sale!.termsVersion });
  await settleCashSale(deps, { cashSaleId: id });
  await recordCashSaleShipment(deps, { cashSaleId: id, actorId: ITEM.ownerId, shipment: { carrier: 'Australia Post', trackingNumber: 'AP1' } });
  await recordCashSaleReceipt(deps, { cashSaleId: id, actorId: BUYER.profileId });
  const accepted = await acceptCashSaleInspection(deps, { cashSaleId: id, actorId: BUYER.profileId });
  return { deps, calls, deferrals, accepted };
}

describe('seller payout holdback (ESC-03)', () => {
  it('a new seller is NOT paid at completion; the deferral spends no attempt', async () => {
    const { calls, deferrals, accepted } = await completeWith(facts({ qualifyingCompletedSales: 0 }));
    expect(accepted.ok && accepted.sale.status).toBe('COMPLETED');
    expect(calls.payouts).toHaveLength(0);
    expect(deferrals).toHaveLength(1);
    expect(deferrals[0]).toMatchObject({ holdReason: null });
    expect((deferrals[0] as { releaseAt: string }).releaseAt).toBeTruthy();
  });

  it('an established seller is paid at once', async () => {
    const { calls, deferrals } = await completeWith(facts({ qualifyingCompletedSales: 5 }));
    expect(calls.payouts).toHaveLength(1);
    expect(deferrals).toHaveLength(0);
  });

  it('an open chargeback HOLDS even an established seller', async () => {
    const { calls, deferrals } = await completeWith(facts({ qualifyingCompletedSales: 5, openChargeDispute: true }));
    expect(calls.payouts).toHaveLength(0);
    expect(deferrals[0]).toMatchObject({ holdReason: 'CHARGE_DISPUTE', releaseAt: null });
  });

  it('a deferral is not reported as a drain failure', async () => {
    const { deps } = await completeWith(facts({ qualifyingCompletedSales: 0 }));
    const onDrainFailure = vi.fn();
    await processDueCashSalePayouts({ ...deps, onDrainFailure }, { limit: 10 });
    expect(onDrainFailure).not.toHaveBeenCalled();
  });
});
