// tests/unit/exposureOverride.test.ts
//
// ESC-03 layer 1: the new-seller open-exposure cap, and staff's per-seller override.
// A non-null override replaces the per-currency limit; 0 pauses the seller; null
// falls back to the default; an established seller is never capped by default. And
// `acceptCashSaleTerms` refuses BEFORE anything is collected.

import { describe, expect, it } from 'vitest';

import {
  NEW_SELLER_COMPLETED_SALES_THRESHOLD,
  NEW_SELLER_OPEN_EXPOSURE_MINOR,
  exceedsNewSellerExposure,
} from '@/domain/payouts/releasePolicy';
import { acceptCashSaleTerms, type CashSaleOrchestratorDeps } from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { BUYER } from './fakes/cashSaleRepository';
import { agreedSale } from './helpers/agreedSale';

const LIMIT = NEW_SELLER_OPEN_EXPOSURE_MINOR.aud;

describe('exceedsNewSellerExposure', () => {
  const base = { qualifyingCompletedSales: 0, openCollectedMinor: 0, currency: 'aud' };

  it('caps a new seller at the per-currency limit', () => {
    expect(exceedsNewSellerExposure({ ...base, addMinor: LIMIT })).toBe(false);
    expect(exceedsNewSellerExposure({ ...base, addMinor: LIMIT + 1 })).toBe(true);
  });

  it('never caps an established seller by default', () => {
    expect(
      exceedsNewSellerExposure({
        ...base,
        qualifyingCompletedSales: NEW_SELLER_COMPLETED_SALES_THRESHOLD,
        addMinor: LIMIT * 10,
      }),
    ).toBe(false);
  });

  it('a non-null override replaces the limit, history or not', () => {
    expect(exceedsNewSellerExposure({ ...base, addMinor: LIMIT * 2, overrideMinor: LIMIT * 3 })).toBe(false);
    expect(
      exceedsNewSellerExposure({
        ...base,
        qualifyingCompletedSales: 99,
        addMinor: 101,
        overrideMinor: 100,
      }),
    ).toBe(true);
  });

  it('an override of 0 pauses the seller', () => {
    expect(exceedsNewSellerExposure({ ...base, addMinor: 1, overrideMinor: 0 })).toBe(true);
  });

  it('a null override falls back to the default', () => {
    expect(exceedsNewSellerExposure({ ...base, addMinor: LIMIT + 1, overrideMinor: null })).toBe(true);
  });
});

describe('acceptCashSaleTerms refuses a capped seller before collecting', () => {
  it('returns SELLER_EXPOSURE_LIMIT and charges nothing', async () => {
    const payments = new InMemoryService();
    const setup = await agreedSale(payments);
    const deps: CashSaleOrchestratorDeps = {
      ...setup.deps,
      repository: {
        ...setup.deps.repository,
        loadSellerExposure: async () => ({
          qualifyingCompletedSales: 0,
          openCollectedMinor: LIMIT,
          overrideMinor: null,
        }),
      },
    };
    const result = await acceptCashSaleTerms(deps, {
      cashSaleId: setup.id,
      actorId: BUYER.profileId,
      termsVersion: setup.termsVersion,
    });
    expect(result).toMatchObject({ ok: false, error: 'SELLER_EXPOSURE_LIMIT' });
    expect(payments.transfers).toHaveLength(0);
    expect((await deps.repository.loadCashSale(setup.id))?.status).toBe('AGREEMENT');
  });
});
