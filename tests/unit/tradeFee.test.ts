// tests/unit/tradeFee.test.ts
//
// The Trade_Fee policy: 5% from each trader, charged on the value that trader
// RECEIVES, with no minimum. Pure arithmetic, so it is tested without a database or
// a provider.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  TRADE_FEE_BPS,
  isTradeFeeRefundable,
  resolveTradeFees,
  tradeFeeCentsFor,
} from '@/domain/trade/tradeFee';

describe('tradeFeeCentsFor', () => {
  it('charges 5% by default', () => {
    expect(TRADE_FEE_BPS).toBe(500);
    expect(tradeFeeCentsFor(126_000, 'aud')).toBe(6_300); // $1,260.00 -> $63.00
    expect(tradeFeeCentsFor(111_000, 'aud')).toBe(5_550); // $1,110.00 -> $55.50
  });

  it('returns whole cents and never a fraction', () => {
    // 5% of $33.33 is $1.6665 — must not leak a sub-cent amount into a charge.
    const fee = tradeFeeCentsFor(3_333, 'aud');
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(167);
  });

  it('is zero for a valueless side and never negative', () => {
    expect(tradeFeeCentsFor(0, 'aud')).toBe(0);
    expect(tradeFeeCentsFor(-5_000, 'aud')).toBe(0);
  });

  it('honours an overridden rate, so the cut can be tuned without a code change', () => {
    expect(tradeFeeCentsFor(100_000, 'aud', 250)).toBe(2_500); // 2.5%
    // A zero rate switches the fee off entirely.
    expect(tradeFeeCentsFor(100_000, 'aud', 0)).toBe(0);
  });

  it('has no per-trader minimum', () => {
    expect(tradeFeeCentsFor(1_000, 'aud')).toBe(50);
    expect(tradeFeeCentsFor(1, 'aud')).toBe(0);
    expect(tradeFeeCentsFor(2_000, 'aud')).toBe(100);
    expect(tradeFeeCentsFor(2_020, 'aud')).toBe(101);
  });

  it('is the same in every currency', () => {
    for (const currency of ['aud', 'AUD', 'usd', null]) {
      expect(tradeFeeCentsFor(1_000, currency)).toBe(50);
    }
  });

  it('is exactly Math.round(value * 500 / 10_000), with no floor (property)', () => {
    expect(TRADE_FEE_BPS).toBe(500);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.constantFrom('aud', 'usd', 'jpy', null),
        (value, currency) => {
          expect(tradeFeeCentsFor(value, currency)).toBe(
            Math.round((value * TRADE_FEE_BPS) / 10_000),
          );
        },
      ),
    );
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

  it('charges each side independently, with no minimum', () => {
    expect(
      resolveTradeFees({
        initiatorReceivesCents: 1_000,
        counterpartReceivesCents: 50_000,
      }),
    ).toEqual({ initiatorFeeCents: 50, counterpartFeeCents: 2_500 });
  });

  it('is the plain percentage of each side (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (a, b) => {
          expect(
            resolveTradeFees({ initiatorReceivesCents: a, counterpartReceivesCents: b }),
          ).toEqual({
            initiatorFeeCents: Math.round((a * 500) / 10_000),
            counterpartFeeCents: Math.round((b * 500) / 10_000),
          });
        },
      ),
    );
  });

  it('bills nothing on a valueless exchange', () => {
    expect(
      resolveTradeFees({
        initiatorReceivesCents: 0,
        counterpartReceivesCents: 0,
      }),
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
