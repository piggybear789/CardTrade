// tests/unit/fxFee.test.ts
//
// The Currency_Conversion fee (0136): who pays it, when, and that the figure a buyer
// is shown is the figure they are charged.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buyerChargeMinorFor,
  chargesCurrencyConversion,
  currencyConversionFeeFor,
  FX_FEE_BPS,
  platformForCurrency,
} from '@/domain/fees/fxFee';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { REGIONS } from '@/domain/region';

describe('which contracts are converted', () => {
  it('does not convert a currency its platform settles in', () => {
    // AUD on the AU platform, USD on the US platform: nothing to convert.
    expect(chargesCurrencyConversion('aud')).toBe(false);
    expect(chargesCurrencyConversion('usd')).toBe(false);
  });

  it('converts every other currency on the US platform', () => {
    for (const currency of ['eur', 'gbp', 'cad', 'chf', 'sek', 'pln']) {
      expect(platformForCurrency(currency)).toBe('US');
      expect(chargesCurrencyConversion(currency)).toBe(true);
    }
  });

  it('maps every trading currency to exactly one platform', () => {
    // The fee is decided from the currency alone, which is only sound while no
    // currency is shared by two platforms.
    const platformsByCurrency = new Map<string, Set<string>>();
    for (const region of REGIONS.filter((r) => r.tradingEnabled)) {
      const set = platformsByCurrency.get(region.currency) ?? new Set<string>();
      set.add(region.platform);
      platformsByCurrency.set(region.currency, set);
    }
    for (const [currency, platforms] of platformsByCurrency) {
      expect(platforms.size, `${currency} spans ${[...platforms].join(', ')}`).toBe(1);
    }
  });

  it('treats an unknown or missing currency as unconverted', () => {
    expect(currencyConversionFeeFor(10_000, null)).toBe(0);
    expect(currencyConversionFeeFor(10_000, 'nzd')).toBe(0);
  });
});

describe('the fee figure', () => {
  it('is the rate of the amount, rounded UP', () => {
    expect(FX_FEE_BPS).toBe(200);
    expect(currencyConversionFeeFor(10_000, 'eur')).toBe(200);
    // 2% of 1,001 is 20.02, which must not round down and leave the platform short.
    expect(currencyConversionFeeFor(1_001, 'eur')).toBe(21);
    expect(currencyConversionFeeFor(0, 'eur')).toBe(0);
  });

  it('never undershoots the exact percentage', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (amount) => {
        const fee = currencyConversionFeeFor(amount, 'gbp');
        expect(fee * 10_000).toBeGreaterThanOrEqual(amount * FX_FEE_BPS);
        expect((fee - 1) * 10_000).toBeLessThan(amount * FX_FEE_BPS);
      }),
    );
  });

  it('charges the buyer the contract total plus the fee, and nothing else', () => {
    expect(buyerChargeMinorFor(10_000, 'eur')).toBe(10_200);
    expect(buyerChargeMinorFor(10_000, 'aud')).toBe(10_000);
  });
});

describe('the listed price agrees with the charge', () => {
  it('includes the conversion fee in the headline for a converted currency', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (price) => {
        const base = price + platformFeeCentsFor(price, 'eur');
        expect(buyerPaysCents(price, 'eur')).toBe(base + currencyConversionFeeFor(base, 'eur'));
      }),
    );
  });

  it('is unchanged for a currency that is not converted', () => {
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_000 + platformFeeCentsFor(10_000, 'aud'));
  });
});
