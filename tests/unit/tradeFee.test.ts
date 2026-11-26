// tests/unit/tradeFee.test.ts
//
// The Trade_Fee (`domain/trade/tradeFee.ts`): 2% per trader of the value that trader
// RECEIVES (product decision 2026-11-27), with no minimum, and 0 when the fee would be
// under Stripe's minimum charge, because an uncollectable fee would block the trade from
// locking (ESC-29).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  STRIPE_MINIMUM_CHARGE_MINOR,
  TRADE_FEE_BPS,
  isTradeFeeRefundable,
  resolveTradeFees,
  stripeMinimumChargeMinor,
  tradeFeeCentsFor,
} from '@/domain/trade/tradeFee';

describe('tradeFeeCentsFor', () => {
  it('is 2% of the value received', () => {
    expect(TRADE_FEE_BPS).toBe(200);
    expect(tradeFeeCentsFor(10_000, 'aud')).toBe(200);
    expect(tradeFeeCentsFor(50_000, 'usd')).toBe(1_000);
    expect(tradeFeeCentsFor(3_333, 'aud')).toBe(67);
  });

  it("is 0 below Stripe's minimum charge, and charged from it", () => {
    // A$25.00 -> A$0.50, exactly the minimum; A$24.99 -> A$0.50 rounds too.
    expect(tradeFeeCentsFor(2_500, 'aud')).toBe(50);
    expect(tradeFeeCentsFor(2_000, 'aud')).toBe(0);
    // GBP's minimum is 30p, so a £20.00 side pays 40p.
    expect(tradeFeeCentsFor(2_000, 'gbp')).toBe(40);
    expect(tradeFeeCentsFor(0, 'aud')).toBe(0);
  });

  it('is either 0 or at least the minimum charge, never a charge Stripe would refuse', () => {
    const currencies = Object.keys(STRIPE_MINIMUM_CHARGE_MINOR);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.constantFrom(...currencies), (value, currency) => {
        const fee = tradeFeeCentsFor(value, currency);
        expect(fee === 0 || fee >= stripeMinimumChargeMinor(currency)).toBe(true);
      }),
    );
  });

  it('still rounds an overridden rate to the nearest minor unit', () => {
    expect(tradeFeeCentsFor(126_000, 'aud', 500)).toBe(6_300);
    expect(tradeFeeCentsFor(3_333, 'aud', 500)).toBe(167);
  });
});

describe('resolveTradeFees', () => {
  it('sizes each trader on what they receive', () => {
    expect(
      resolveTradeFees({ initiatorReceivesCents: 50_000, counterpartReceivesCents: 70_000, currency: 'aud' }),
    ).toEqual({ initiatorFeeCents: 1_000, counterpartFeeCents: 1_400 });
  });

  it('at an overridden rate', () => {
    expect(
      resolveTradeFees({ initiatorReceivesCents: 50_000, counterpartReceivesCents: 70_000, currency: 'aud', rateBps: 500 }),
    ).toEqual({ initiatorFeeCents: 2_500, counterpartFeeCents: 3_500 });
  });
});

describe('isTradeFeeRefundable', () => {
  it('refunds only a settled fee', () => {
    expect(isTradeFeeRefundable('SETTLED')).toBe(true);
    expect(isTradeFeeRefundable('PENDING')).toBe(false);
    expect(isTradeFeeRefundable('FAILED')).toBe(false);
    expect(isTradeFeeRefundable('REFUNDED')).toBe(false);
  });
});
