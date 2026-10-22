// tests/unit/tradeFee.test.ts
//
// Trades carry no fee: a swap's collateral is a card hold Stripe does not charge for,
// so there is no cost to pass through (`domain/trade/tradeFee.ts`). The rate machinery
// stays so a fee could return through `TRADE_FEE_BPS` alone; the overridden-rate cases
// pin that it still rounds correctly when it does.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TRADE_FEE_BPS,
  isTradeFeeRefundable,
  resolveTradeFees,
  tradeFeeCentsFor,
} from '@/domain/trade/tradeFee';

describe('tradeFeeCentsFor', () => {
  it('is zero at the default rate for any value', () => {
    expect(TRADE_FEE_BPS).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (value) => {
        expect(tradeFeeCentsFor(value, 'aud')).toBe(0);
      }),
    );
  });

  it('still rounds an overridden rate to the nearest minor unit, with no minimum', () => {
    expect(tradeFeeCentsFor(126_000, 'aud', 500)).toBe(6_300);
    expect(tradeFeeCentsFor(3_333, 'aud', 500)).toBe(167);
    expect(tradeFeeCentsFor(100, 'aud', 500)).toBe(5);
    expect(tradeFeeCentsFor(0, 'aud', 500)).toBe(0);
  });
});

describe('resolveTradeFees', () => {
  it('charges neither trader at the default rate', () => {
    expect(
      resolveTradeFees({ initiatorReceivesCents: 50_000, counterpartReceivesCents: 70_000 }),
    ).toEqual({ initiatorFeeCents: 0, counterpartFeeCents: 0 });
  });

  it('sizes each trader on what they receive at an overridden rate', () => {
    expect(
      resolveTradeFees({ initiatorReceivesCents: 50_000, counterpartReceivesCents: 70_000, rateBps: 500 }),
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
