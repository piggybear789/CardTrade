// tests/unit/tradeFee.test.ts
//
// The Trade_Fee policy: 5% from each trader, charged on the value that trader
// RECEIVES. Pure arithmetic, so it is tested without a database or a provider.

import { describe, expect, it } from 'vitest';

import {
  TRADE_FEE_BPS,
  isTradeFeeRefundable,
  resolveTradeFees,
  tradeFeeCentsFor,
} from '@/domain/trade/tradeFee';

describe('tradeFeeCentsFor', () => {
  it('charges 5% by default', () => {
    expect(TRADE_FEE_BPS).toBe(500);
    expect(tradeFeeCentsFor(126_000)).toBe(6_300); // $1,260.00 -> $63.00
    expect(tradeFeeCentsFor(111_000)).toBe(5_550); // $1,110.00 -> $55.50
  });

  it('returns whole cents and never a fraction', () => {
    // 5% of $33.33 is $1.6665 — must not leak a sub-cent amount into a charge.
    const fee = tradeFeeCentsFor(3_333);
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(167);
  });

  it('is zero for a valueless side and never negative', () => {
    expect(tradeFeeCentsFor(0)).toBe(0);
    expect(tradeFeeCentsFor(-5_000)).toBe(0);
  });

  it('honours an overridden rate, so the cut can be tuned without a code change', () => {
    expect(tradeFeeCentsFor(100_000, 250)).toBe(2_500); // 2.5%
    expect(tradeFeeCentsFor(100_000, 0)).toBe(0);
  });
});

describe('resolveTradeFees', () => {
  it('charges each trader on what THEY receive, so unequal sides pay unequal fees', () => {
    // Phil gives $1,110 of card plus $150 cash; Cara gives $1,260 of card.
    // Phil receives $1,260. Cara receives $1,110 + $150 = $1,260.
    expect(
      resolveTradeFees({
        initiatorReceivesCents: 126_000,
        counterpartReceivesCents: 126_000,
      }),
    ).toEqual({ initiatorFeeCents: 6_300, counterpartFeeCents: 6_300 });

    // A genuinely lopsided swap bills the sides differently. This is the property
    // that makes "5% each" meaningful rather than "5% of one side, split".
    expect(
      resolveTradeFees({
        initiatorReceivesCents: 126_000,
        counterpartReceivesCents: 111_000,
      }),
    ).toEqual({ initiatorFeeCents: 6_300, counterpartFeeCents: 5_550 });
  });

  it('bills nothing on a valueless exchange', () => {
    expect(
      resolveTradeFees({ initiatorReceivesCents: 0, counterpartReceivesCents: 0 }),
    ).toEqual({ initiatorFeeCents: 0, counterpartFeeCents: 0 });
  });
});

describe('isTradeFeeRefundable', () => {
  it('refunds only a fee that was actually collected', () => {
    expect(isTradeFeeRefundable('SETTLED')).toBe(true);
    // Refunding either of these would spend the platform's own money: neither took
    // anything from the trader in the first place.
    expect(isTradeFeeRefundable('PENDING')).toBe(false);
    expect(isTradeFeeRefundable('FAILED')).toBe(false);
    // And a refunded fee must not be refunded twice.
    expect(isTradeFeeRefundable('REFUNDED')).toBe(false);
  });
});
