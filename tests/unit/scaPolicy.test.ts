// tests/unit/scaPolicy.test.ts — ESC-03 layer 2: when a collection is challenged.

import { describe, expect, it } from 'vitest';

import {
  NEW_BUYER_PURCHASES,
  THREE_DS_ALWAYS_ABOVE_MINOR,
  decideThreeDS,
} from '@/domain/payments/scaPolicy';

describe('decideThreeDS', () => {
  it('challenges a new buyer whatever the amount', () => {
    expect(decideThreeDS({ completedPurchases: 0, amountMinor: 100, currency: 'aud' })).toBe('any');
    expect(
      decideThreeDS({ completedPurchases: NEW_BUYER_PURCHASES - 1, amountMinor: 100, currency: 'aud' }),
    ).toBe('any');
  });

  it('challenges an established buyer at or above the threshold', () => {
    const at = THREE_DS_ALWAYS_ABOVE_MINOR.aud;
    expect(decideThreeDS({ completedPurchases: 10, amountMinor: at, currency: 'aud' })).toBe('any');
    expect(decideThreeDS({ completedPurchases: 10, amountMinor: at - 1, currency: 'aud' })).toBe(
      'automatic',
    );
  });

  it('is case-insensitive on currency', () => {
    expect(decideThreeDS({ completedPurchases: 10, amountMinor: 100, currency: 'AUD' })).toBe('automatic');
  });

  it('always challenges an unlisted currency', () => {
    expect(decideThreeDS({ completedPurchases: 99, amountMinor: 1, currency: 'gbp' })).toBe('any');
  });
});
