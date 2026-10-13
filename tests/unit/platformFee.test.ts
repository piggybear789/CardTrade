// tests/unit/platformFee.test.ts
//
// The Cash_Sale Platform_Fee: a plain 5% of the item price with no minimum.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { percentageFeeMinor } from '@/domain/fees/percentageFee';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import { platformFeePhrase, platformFeeRateLabel, tradeFeeRateLabel } from '@/lib/fees/feeLabels';

describe('platformFeeCentsFor', () => {
  it('is 5% of the item price', () => {
    expect(PLATFORM_FEE_BPS).toBe(500);
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(500);
    expect(platformFeeCentsFor(84_500, 'aud')).toBe(4_225);
  });

  it('has no minimum: small contracts pay the plain 5%', () => {
    expect(platformFeeCentsFor(1, 'aud')).toBe(0);
    expect(platformFeeCentsFor(9, 'aud')).toBe(0);
    expect(platformFeeCentsFor(10, 'aud')).toBe(1); // 0.5 rounds up
    expect(platformFeeCentsFor(1_000, 'aud')).toBe(50);
    expect(platformFeeCentsFor(2_000, 'aud')).toBe(100);
    expect(platformFeeCentsFor(3_000, 'aud')).toBe(150);
    expect(platformFeeCentsFor(3_010, 'aud')).toBe(151); // 150.5 rounds up
  });

  it('charges nothing on a zero price', () => {
    expect(platformFeeCentsFor(0, 'aud')).toBe(0);
  });

  it('is the same in every currency', () => {
    for (const currency of ['aud', 'usd', 'jpy', null]) {
      expect(platformFeeCentsFor(1_000, currency)).toBe(50);
    }
    expect(platformFeeCentsFor(1_000)).toBe(50);
  });

  it('is exactly Math.round(price * 500 / 10_000), with no floor (property)', () => {
    expect(PLATFORM_FEE_BPS).toBe(500);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.constantFrom('aud', 'usd', 'gbp', 'jpy', null),
        (price, currency) => {
          const fee = platformFeeCentsFor(price, currency);
          expect(Number.isInteger(fee)).toBe(true);
          expect(fee).toBe(Math.round((price * PLATFORM_FEE_BPS) / 10_000));
        },
      ),
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

describe('percentageFeeMinor', () => {
  it('yields zero at a zero rate or a non-positive base', () => {
    expect(percentageFeeMinor(10_000, 0)).toBe(0);
    expect(percentageFeeMinor(0, 500)).toBe(0);
    expect(percentageFeeMinor(-5, 500)).toBe(0);
  });
});

describe('what the buyer is shown', () => {
  it('folds the plain fee into the fee-inclusive headline', () => {
    expect(buyerPaysCents(1_000, 'aud')).toBe(1_050);
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_500);
  });

  it('names the bare rate, with no minimum', () => {
    expect(platformFeeRateLabel('aud')).toBe('5%');
    expect(tradeFeeRateLabel('aud')).toBe('5%');
    expect(platformFeeRateLabel('usd')).toBe('5%');
    expect(platformFeeRateLabel()).toBe('5%');
    expect(platformFeePhrase('aud')).toBe('5% of the item price');
    expect(platformFeeRateLabel('aud')).not.toMatch(/min/i);
  });
});
