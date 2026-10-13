// tests/unit/releasePolicyCurrencies.test.ts
//
// Every currency a member can trade in must have a new-seller exposure limit and a
// qualifying-sale minimum. Without one the policy fails closed, and every seller in
// that currency is refused at Pay with no way to become established.

import { describe, expect, it } from 'vitest';

import { tradingRegions } from '@/domain/region';
import {
  NEW_SELLER_OPEN_EXPOSURE_MINOR,
  QUALIFYING_SALE_MIN_MINOR,
  exceedsNewSellerExposure,
} from '@/domain/payouts/releasePolicy';

const currencies = [...new Set(tradingRegions().map((region) => region.currency.toLowerCase()))];

describe('release policy covers every trading currency', () => {
  it('has trading currencies to check', () => {
    expect(currencies.length).toBeGreaterThan(0);
  });

  it.each(currencies)('%s has an exposure limit and a qualifying minimum', (currency) => {
    expect(NEW_SELLER_OPEN_EXPOSURE_MINOR[currency], `exposure ${currency}`).toBeGreaterThan(0);
    expect(QUALIFYING_SALE_MIN_MINOR[currency], `qualifying ${currency}`).toBeGreaterThan(0);
  });

  it.each(currencies)('a new %s seller can take a first small sale', (currency) => {
    expect(
      exceedsNewSellerExposure({
        qualifyingCompletedSales: 0,
        openCollectedMinor: 0,
        addMinor: QUALIFYING_SALE_MIN_MINOR[currency],
        currency,
      }),
    ).toBe(false);
  });

  it('still refuses a currency nobody can trade in', () => {
    expect(
      exceedsNewSellerExposure({ qualifyingCompletedSales: 0, openCollectedMinor: 0, addMinor: 1, currency: 'xyz' }),
    ).toBe(true);
  });
});
