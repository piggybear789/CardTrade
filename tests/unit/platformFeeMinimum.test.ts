// tests/unit/platformFeeMinimum.test.ts
//
// The Cash_Sale Platform_Fee: 5% of the item price, floored per CONTRACT by the
// currency's minimum so a low-value sale still covers the provider's fixed costs.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  PLATFORM_FEE_MINIMUM_MINOR,
  feeMinimumMinor,
  percentageFeeWithMinimum,
} from '@/domain/fees/feeMinimums';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import { platformFeePhrase, platformFeeRateLabel, tradeFeeRateLabel } from '@/lib/fees/feeLabels';

describe('platformFeeCentsFor', () => {
  it('is 5% above the crossover', () => {
    expect(PLATFORM_FEE_BPS).toBe(500);
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(500);
    expect(platformFeeCentsFor(84_500, 'aud')).toBe(4_225);
  });

  it('floors a small AUD contract at $1.50', () => {
    expect(PLATFORM_FEE_MINIMUM_MINOR.aud).toBe(150);
    expect(platformFeeCentsFor(1, 'aud')).toBe(150);
    expect(platformFeeCentsFor(1_000, 'aud')).toBe(150);
    expect(platformFeeCentsFor(2_000, 'aud')).toBe(150);
  });

  it('hands over to the percentage at $30', () => {
    expect(platformFeeCentsFor(3_000, 'aud')).toBe(150);
    expect(platformFeeCentsFor(3_010, 'aud')).toBe(151);
  });

  it('charges nothing on a zero price rather than the minimum', () => {
    expect(platformFeeCentsFor(0, 'aud')).toBe(0);
  });

  it('applies no floor where none is on file', () => {
    expect(platformFeeCentsFor(1_000, 'usd')).toBe(50);
    expect(platformFeeCentsFor(1_000, 'jpy')).toBe(50);
    expect(platformFeeCentsFor(1_000, null)).toBe(50);
  });

  it('is never below the percentage and never below the floor (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (price) => {
        const fee = platformFeeCentsFor(price, 'aud');
        expect(Number.isInteger(fee)).toBe(true);
        expect(fee).toBeGreaterThanOrEqual(Math.round((price * PLATFORM_FEE_BPS) / 10_000));
        expect(fee).toBeGreaterThanOrEqual(150);
      }),
    );
  });

  it('is non-decreasing in price (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(platformFeeCentsFor(lo, 'aud')).toBeLessThanOrEqual(
            platformFeeCentsFor(hi, 'aud'),
          );
        },
      ),
    );
  });
});

describe('feeMinimums helpers', () => {
  it('treats an unknown or missing currency as no floor', () => {
    expect(feeMinimumMinor(PLATFORM_FEE_MINIMUM_MINOR, 'xyz')).toBe(0);
    expect(feeMinimumMinor(PLATFORM_FEE_MINIMUM_MINOR, undefined)).toBe(0);
  });

  it('switches the fee off entirely at a zero rate', () => {
    expect(percentageFeeWithMinimum(10_000, 0, 150)).toBe(0);
  });
});

describe('what the buyer is shown', () => {
  it('folds the minimum into the fee-inclusive headline', () => {
    expect(buyerPaysCents(1_000, 'aud')).toBe(1_150);
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_500);
  });

  it('names the minimum alongside the rate', () => {
    expect(platformFeeRateLabel('aud')).toBe('5%, min $1.50');
    expect(tradeFeeRateLabel('aud')).toBe('5%, min $1.00');
    expect(platformFeeRateLabel('usd')).toBe('5%');
    expect(platformFeePhrase('aud')).toBe('5% of the item price, with a minimum of $1.50');
  });
});
