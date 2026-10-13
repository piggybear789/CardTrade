// tests/unit/trackingBinding.test.ts
//
// ESC-12: a return tracking number must be a parcel posted for THIS return, and a
// number bound to another contract is refused on both legs.

import { describe, expect, it } from 'vitest';

import {
  recordCashSaleReturnShipment,
  resolveCashSaleDispute,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import type { TrackingService, TrackingSnapshot } from '@/domain/services/tracking/types';
import { BUYER, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { disputedCashSale } from './helpers/disputedCashSale';

function trackingReturning(extra: Partial<TrackingSnapshot>, seen: unknown[] = []): TrackingService {
  return {
    async registerShipment(input) {
      seen.push(input);
      return {
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: null,
        status: 'LABEL_CREATED',
        // Only the return parcel; the outbound leg in setup stays ordinary.
        ...(input.trackingNumber === 'RET-1' ? extra : {}),
      };
    },
  };
}

async function returnPending(tracking: TrackingService, overrides: Partial<CashSaleOrchestratorDeps> = {}) {
  const { repository } = makeCashSaleRepository();
  const { payments } = makePayments({});
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking,
    ...overrides,
  };
  const sale = await disputedCashSale(deps);
  const resolved = await resolveCashSaleDispute(deps, {
    cashSaleId: sale.id,
    actorId: 'admin-1',
    outcome: 'REFUND_BUYER',
  });
  if (!resolved.ok) throw new Error('setup');
  return { deps, sale: resolved.sale };
}

const post = (deps: CashSaleOrchestratorDeps, cashSaleId: string) =>
  recordCashSaleReturnShipment(deps, {
    cashSaleId,
    actorId: BUYER.profileId,
    carrier: 'Australia Post',
    trackingNumber: 'RET-1',
  });

describe('return tracking binding (ESC-12)', () => {
  it('refuses a number that already shows as delivered', async () => {
    const { deps, sale } = await returnPending(trackingReturning({ status: 'DELIVERED' }));
    const result = await post(deps, sale.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TRACKING_ALREADY_DELIVERED');
  });

  it('refuses a parcel scanned before the dispute was decided', async () => {
    const { deps, sale } = await returnPending(trackingReturning({ firstEventAt: '2000-01-01T00:00:00Z' }));
    const result = await post(deps, sale.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TRACKING_PREDATES_DISPUTE');
  });

  it('records a label created earlier when the first scan is after the decision', async () => {
    const { deps, sale } = await returnPending(trackingReturning({ firstEventAt: '2999-01-01T00:00:00Z' }));
    expect((await post(deps, sale.id)).ok).toBe(true);
  });

  it('records a number with no carrier events yet', async () => {
    const { deps, sale } = await returnPending(trackingReturning({ firstEventAt: null }));
    expect((await post(deps, sale.id)).ok).toBe(true);
  });

  it('maps the database binding refusal to TRACKING_IN_USE', async () => {
    const { deps, sale } = await returnPending(trackingReturning({}));
    const repository = {
      ...deps.repository,
      recordReturnShipment: async () => {
        throw new Error('tracking-in-use');
      },
    };
    const result = await post({ ...deps, repository }, sale.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TRACKING_IN_USE');
  });

  it('passes the return address country to the carrier and warns on a mismatch', async () => {
    const seen: Array<{ destinationCountryCode?: string | null }> = [];
    const warnings: unknown[] = [];
    const { deps, sale } = await returnPending(
      trackingReturning({ destinationCountryCode: 'NZ' }, seen),
      { onTrackingWarning: (w) => warnings.push(w) },
    );
    const repository = { ...deps.repository, loadDestinationCountry: async () => 'AU' };
    expect((await post({ ...deps, repository }, sale.id)).ok).toBe(true);
    expect(seen.at(-1)?.destinationCountryCode).toBe('AU');
    expect(warnings).toHaveLength(1);
  });
});
