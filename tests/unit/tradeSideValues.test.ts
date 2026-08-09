// tests/unit/tradeSideValues.test.ts
//
// The binder rule (0081). These assertions exist because the numbers under test
// decide how much of a member's card gets authorised and what they are charged —
// getting them wrong is not a display bug.
//
// The property that matters most is the LAST one: collateral, the charged fee and
// the disclosed fee all read this one function, so a binder trade cannot end up
// authorising one figure while showing another.

import { describe, expect, it } from 'vitest';

import {
  resolveTradeSideValues,
  tradeSidesAreValued,
} from '@/domain/trade/tradeSideValues';

describe('resolveTradeSideValues', () => {
  it('leaves an ordinary trade alone', () => {
    expect(
      resolveTradeSideValues({
        initiatorGoodsCents: 15_000,
        counterpartGoodsCents: 20_000,
        counterpartIsShopfront: false,
      }),
    ).toEqual({ initiatorSideCents: 15_000, counterpartSideCents: 20_000 });
  });

  it('values a binder side at what is offered against it, never at its own price', () => {
    // 500_000 is the binder's indicative "from" price for the WHOLE inventory. If it
    // leaked through, both traders would be asked to authorise $5,000 for a $150 swap.
    const sides = resolveTradeSideValues({
      initiatorGoodsCents: 15_000,
      counterpartGoodsCents: 500_000,
      counterpartIsShopfront: true,
    });
    expect(sides).toEqual({ initiatorSideCents: 15_000, counterpartSideCents: 15_000 });
    expect(sides.counterpartSideCents).not.toBe(500_000);
  });

  it('is symmetric on a binder trade, which is what makes equal collateral fair', () => {
    const sides = resolveTradeSideValues({
      initiatorGoodsCents: 8_050,
      counterpartGoodsCents: 0,
      counterpartIsShopfront: true,
    });
    expect(sides.initiatorSideCents).toBe(sides.counterpartSideCents);
  });

  it('truncates to whole minor units and never returns a negative side', () => {
    expect(
      resolveTradeSideValues({
        initiatorGoodsCents: -50,
        counterpartGoodsCents: 10_000.7,
        counterpartIsShopfront: false,
      }),
    ).toEqual({ initiatorSideCents: 0, counterpartSideCents: 10_000 });
  });
});

describe('tradeSidesAreValued', () => {
  it('refuses a side worth nothing rather than reading it as "no bond needed"', () => {
    // Reachable on a binder trade specifically: the binder side inherits its value,
    // so an unvalued offering side makes BOTH sides zero. The acceptance path treats
    // a zero bond total as "nobody owes one" and confirms escrow, which would mean an
    // exchange with no collateral behind it.
    expect(tradeSidesAreValued({ initiatorSideCents: 0, counterpartSideCents: 0 })).toBe(
      false,
    );
    expect(
      tradeSidesAreValued({ initiatorSideCents: 100, counterpartSideCents: 0 }),
    ).toBe(false);
    expect(
      tradeSidesAreValued({ initiatorSideCents: 100, counterpartSideCents: 100 }),
    ).toBe(true);
  });

  it('rejects the zero-value binder trade end to end', () => {
    const sides = resolveTradeSideValues({
      initiatorGoodsCents: 0,
      counterpartGoodsCents: 500_000,
      counterpartIsShopfront: true,
    });
    expect(tradeSidesAreValued(sides)).toBe(false);
  });
});

describe('agreement with the SQL guards in 0081', () => {
  it('keeps the binder OUT of the offering side, so a value always exists to derive from', () => {
    // The rule only works because a SHOPFRONT can never be the offering side — that is
    // enforced in `open_trade_negotiation` (`shopfront-cannot-be-offered`) and by the
    // `listing_kind = 'SINGLE'` filter on both own-item pickers. If a binder could be
    // offered, both sides would inherit from each other and nothing would be valued.
    const sides = resolveTradeSideValues({
      initiatorGoodsCents: 25_000,
      counterpartGoodsCents: 999_999,
      counterpartIsShopfront: true,
    });
    expect(sides.initiatorSideCents).toBe(25_000);
    expect(tradeSidesAreValued(sides)).toBe(true);
  });
});
