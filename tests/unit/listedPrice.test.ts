import { describe, expect, it } from 'vitest';

import { askingPriceRange, buyerPaysCents, listedPriceCents } from '@/lib/listings/buyerPrice';

describe('listedPriceCents', () => {
  it('shows a single listing at what the buyer is charged', () => {
    expect(listedPriceCents(40_000_000, 'aud', false)).toBe(buyerPaysCents(40_000_000, 'aud'));
    expect(listedPriceCents(40_000_000, 'aud', false)).toBe(42_000_000);
  });

  it('shows a shopfront at its asking "from" figure', () => {
    expect(listedPriceCents(350_000, 'aud', true)).toBe(350_000);
  });

  it('applies the currency minimum fee on cheap singles', () => {
    expect(listedPriceCents(500, 'aud', false)).toBe(500 + 150);
  });
});

describe('askingPriceRange', () => {
  const charges = (asking: number) => buyerPaysCents(asking, 'aud');

  it('inverts each bound exactly', () => {
    for (const listed of [0, 1, 149, 150, 151, 650, 2_999, 3_150, 105_000, 42_000_000]) {
      const { minCents, maxCents } = askingPriceRange({ minCents: listed, maxCents: listed }, 'aud');
      // The smallest asking price charging at least the bound...
      expect(charges(minCents!)).toBeGreaterThanOrEqual(listed);
      if (minCents! > 0) expect(charges(minCents! - 1)).toBeLessThan(listed);
      // ...and the largest charging at most it.
      expect(charges(maxCents!)).toBeLessThanOrEqual(listed);
      expect(charges(maxCents! + 1)).toBeGreaterThan(listed);
    }
  });

  it('keeps an omitted bound omitted', () => {
    expect(askingPriceRange({ minCents: 1_000 }, 'aud').maxCents).toBeUndefined();
    expect(askingPriceRange({ maxCents: 1_000 }, 'aud').minCents).toBeUndefined();
  });

  it('matches nothing below zero', () => {
    expect(askingPriceRange({ maxCents: -5 }, 'aud').maxCents).toBe(-1);
  });
});
