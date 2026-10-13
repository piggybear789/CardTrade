// tests/property/postagePolicy.property.test.ts
//
// ESC-28: the postage bounds behave as money rules must.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  POSTAGE_ABSOLUTE_CAP_MINOR,
  POSTAGE_FEE_FREE_ALLOWANCE_MINOR,
  feeBaseMinor,
  isPostageOutlier,
  postageCapMinor,
} from '@/domain/fees/postagePolicy';

const minor = fc.integer({ min: 0, max: 10_000_000 });

describe('postage policy (ESC-28)', () => {
  it('fee base is never below the item price', () => {
    fc.assert(fc.property(minor, minor, (item, postage) => feeBaseMinor(item, postage) >= item));
  });

  it('fee base never decreases as postage rises', () => {
    fc.assert(
      fc.property(minor, minor, minor, (item, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return feeBaseMinor(item, lo) <= feeBaseMinor(item, hi);
      }),
    );
  });

  it('cap is at least the allowance and at most the absolute cap', () => {
    fc.assert(
      fc.property(minor, (item) => {
        const cap = postageCapMinor(item);
        return cap >= POSTAGE_FEE_FREE_ALLOWANCE_MINOR && cap <= POSTAGE_ABSOLUTE_CAP_MINOR;
      }),
    );
  });

  it('examples', () => {
    expect(postageCapMinor(100)).toBe(POSTAGE_FEE_FREE_ALLOWANCE_MINOR);
    expect(feeBaseMinor(10_000, 2_000)).toBe(10_000);
    expect(feeBaseMinor(10_000, 4_000)).toBe(11_500);
    expect(isPostageOutlier(1_000, 3_000)).toBe(true);
    expect(isPostageOutlier(10_000, 1_500)).toBe(false);
  });
});
