// tests/unit/qualifyingSales.test.ts
//
// "Established" must mean independent buyers who each paid a real amount and had time
// to dispute it (design §1.1, review #16). A raw COMPLETED count let a Sybil pair
// self-deal three $1 sales and skip the holdback in a day.

import { describe, expect, it } from 'vitest';

import { countQualifyingSales, type CompletedSaleFact } from '@/domain/payouts/releasePolicy';

const NOW = new Date('2026-05-10T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function sale(over: Partial<CompletedSaleFact> = {}): CompletedSaleFact {
  return {
    buyerId: 'buyer-1',
    agreedPriceMinor: 5_000,
    currency: 'aud',
    paymentSettledAt: daysAgo(20),
    chargeDisputed: false,
    buyerRelated: false,
    ...over,
  };
}

describe('countQualifyingSales', () => {
  it('counts distinct buyers, so three sales to one buyer count once', () => {
    expect(countQualifyingSales([sale(), sale(), sale()], NOW)).toBe(1);
    expect(
      countQualifyingSales([sale(), sale({ buyerId: 'buyer-2' }), sale({ buyerId: 'buyer-3' })], NOW),
    ).toBe(3);
  });

  it('ignores a sale under the per-currency minimum', () => {
    expect(countQualifyingSales([sale({ agreedPriceMinor: 1_999 })], NOW)).toBe(0);
    expect(countQualifyingSales([sale({ agreedPriceMinor: 2_000 })], NOW)).toBe(1);
  });

  it('ignores a sale younger than 14 days', () => {
    expect(countQualifyingSales([sale({ paymentSettledAt: daysAgo(13) })], NOW)).toBe(0);
    expect(countQualifyingSales([sale({ paymentSettledAt: daysAgo(14) })], NOW)).toBe(1);
  });

  it('ignores a charge-disputed sale', () => {
    expect(countQualifyingSales([sale({ chargeDisputed: true })], NOW)).toBe(0);
  });

  it('ignores a sale to a related buyer', () => {
    expect(countQualifyingSales([sale({ buyerRelated: true })], NOW)).toBe(0);
  });

  it('never counts a sale in an unlisted currency', () => {
    expect(countQualifyingSales([sale({ currency: 'gbp', agreedPriceMinor: 1_000_000 })], NOW)).toBe(0);
  });

  it('accepts an upper-case currency code', () => {
    expect(countQualifyingSales([sale({ currency: 'USD' })], NOW)).toBe(1);
  });
});
