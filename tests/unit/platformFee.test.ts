// tests/unit/platformFee.test.ts
//
// The Cash_Sale Platform_Fee. The STANDARD rate is a plain 5% of the item price with
// no minimum; during the beta (`BETA_FEE_WAIVER`) the applied fee is 0 for every
// price. Both sides of the switch are covered so ending the beta is a flip, not a
// rewrite.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { percentageFeeMinor } from '@/domain/fees/percentageFee';
import { BETA_FEE_WAIVER, effectiveFeeBps } from '@/domain/fees/betaFeeWaiver';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import {
  FEE_POPOVER_WAIVED_FOOTNOTE,
  FEE_POPOVER_WAIVED_TITLE,
  FEE_POPOVER_WAIVED_TRIGGER,
  FEE_WAIVED_HINT,
  LISTING_BETA_FEE_NOTE,
  NO_FEE_DURING_BETA,
  TERMS_BETA_FEE_SENTENCE,
  TILE_BETA_FEE_NOTE,
  betaFeeNote,
  feesWaivedForBeta,
  platformFeePhrase,
  platformFeeRateLabel,
  platformFeeRowRate,
  tradeFeeRateLabel,
  tradeFeeRowRate,
} from '@/lib/fees/feeLabels';

/** The standard-rate function: what `platformFeeCentsFor` charges once the beta ends. */
const standardFee = (price: number) => percentageFeeMinor(price, PLATFORM_FEE_BPS);

describe('the beta fee waiver switch', () => {
  it('applies the standard rate when off and zero when on', () => {
    expect(effectiveFeeBps(500, false)).toBe(500);
    expect(effectiveFeeBps(500, true)).toBe(0);
    expect(effectiveFeeBps(500)).toBe(BETA_FEE_WAIVER ? 0 : 500);
  });

  it('platformFeeCentsFor is the standard rule at the effective rate (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.constantFrom('aud', 'usd', 'gbp', 'jpy', null),
        (price, currency) => {
          expect(platformFeeCentsFor(price, currency)).toBe(
            percentageFeeMinor(price, effectiveFeeBps(PLATFORM_FEE_BPS)),
          );
        },
      ),
    );
  });
});

describe.runIf(BETA_FEE_WAIVER)('platformFeeCentsFor during the beta', () => {
  it('charges nothing', () => {
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(0);
    expect(platformFeeCentsFor(84_500, 'aud')).toBe(0);
    expect(platformFeeCentsFor(40_000_000, 'aud')).toBe(0);
    expect(platformFeeCentsFor(1_000)).toBe(0);
  });

  it('is 0 for any price in any currency (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.constantFrom('aud', 'usd', 'gbp', 'jpy', null),
        (price, currency) => {
          expect(platformFeeCentsFor(price, currency)).toBe(0);
        },
      ),
    );
  });

  it('adds nothing to the buyer headline', () => {
    expect(buyerPaysCents(1_000, 'aud')).toBe(1_000);
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_000);
  });
});

describe('the standard Platform_Fee rate', () => {
  it('is 5% of the item price', () => {
    expect(PLATFORM_FEE_BPS).toBe(500);
    expect(standardFee(10_000)).toBe(500);
    expect(standardFee(84_500)).toBe(4_225);
  });

  it('has no minimum: small contracts pay the plain 5%', () => {
    expect(standardFee(1)).toBe(0);
    expect(standardFee(9)).toBe(0);
    expect(standardFee(10)).toBe(1); // 0.5 rounds up
    expect(standardFee(1_000)).toBe(50);
    expect(standardFee(2_000)).toBe(100);
    expect(standardFee(3_000)).toBe(150);
    expect(standardFee(3_010)).toBe(151); // 150.5 rounds up
  });

  it('charges nothing on a zero price', () => {
    expect(standardFee(0)).toBe(0);
  });

  it('is exactly Math.round(price * 500 / 10_000), with no floor (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (price) => {
        const fee = standardFee(price);
        expect(Number.isInteger(fee)).toBe(true);
        expect(fee).toBe(Math.round((price * PLATFORM_FEE_BPS) / 10_000));
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
          expect(standardFee(lo)).toBeLessThanOrEqual(standardFee(hi));
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
  it('folds the effective fee into the fee-inclusive headline', () => {
    expect(buyerPaysCents(1_000, 'aud')).toBe(1_000 + platformFeeCentsFor(1_000, 'aud'));
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_000 + platformFeeCentsFor(10_000, 'aud'));
  });

  it('names the bare standard rate, with no minimum', () => {
    expect(platformFeeRateLabel('aud')).toBe('5%');
    expect(tradeFeeRateLabel('aud')).toBe('5%');
    expect(platformFeeRateLabel('usd')).toBe('5%');
    expect(platformFeeRateLabel()).toBe('5%');
    expect(platformFeePhrase('aud')).toBe('5% of the item price');
    expect(platformFeeRateLabel('aud')).not.toMatch(/min/i);
  });

  it('says plainly that fees are waived during beta and names the normal rate', () => {
    expect(feesWaivedForBeta()).toBe(BETA_FEE_WAIVER);
    expect(betaFeeNote()).toBe('No fees during beta (normally 5%)');
    expect(platformFeeRowRate(0)).toBe('waived during beta, normally 5%');
    expect(platformFeeRowRate(500)).toBe('5%');
    expect(tradeFeeRowRate(0)).toBe('waived during beta, normally 5%');
    expect(tradeFeeRowRate(500)).toBe('5%');
  });

  it('never prints a $0.00 fee or a minimum in beta copy', () => {
    for (const text of [
      betaFeeNote(),
      LISTING_BETA_FEE_NOTE,
      NO_FEE_DURING_BETA,
      TILE_BETA_FEE_NOTE,
      FEE_WAIVED_HINT,
      FEE_POPOVER_WAIVED_TRIGGER,
      FEE_POPOVER_WAIVED_TITLE,
      FEE_POPOVER_WAIVED_FOOTNOTE,
      TERMS_BETA_FEE_SENTENCE,
      platformFeeRowRate(0),
      tradeFeeRowRate(0),
    ]) {
      expect(text).not.toMatch(/\$0\.00|min/i);
    }
  });
});
