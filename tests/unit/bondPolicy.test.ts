// tests/unit/bondPolicy.test.ts
//
// The Bond Policy (revised Req 2.4, 5.4): trust is either identity or money.
// A verified Trader (provider-approved Managed Merchant onboarding) posts no
// bond; anyone else bonds against the Item's Fair_Market_Value.

import { describe, expect, it } from 'vitest';

import {
  canPostRequiredBond,
  isBondExempt,
  requiredBondCents,
  resolveTradeBonds,
} from '@/domain/bond/bondPolicy';

describe('requiredBondCents', () => {
  it('exempts a verified trader entirely', () => {
    expect(requiredBondCents({ verified: true, fmvCents: 250_000 })).toBe(0);
    expect(isBondExempt(true)).toBe(true);
  });

  it('bonds an unverified trader at 100% of FMV by default', () => {
    expect(requiredBondCents({ verified: false, fmvCents: 5_000 })).toBe(5_000);
    expect(isBondExempt(false)).toBe(false);
  });

  it('applies a configurable rate, floor and ceiling', () => {
    // 20% of $500.00 = $100.00
    expect(
      requiredBondCents({
        verified: false,
        fmvCents: 50_000,
        policy: { unverifiedRateBps: 2_000 },
      }),
    ).toBe(10_000);

    // Floor lifts a small bond.
    expect(
      requiredBondCents({
        verified: false,
        fmvCents: 1_000,
        policy: { unverifiedRateBps: 2_000, floorCents: 2_500 },
      }),
    ).toBe(1_000); // never more than the value at stake

    expect(
      requiredBondCents({
        verified: false,
        fmvCents: 10_000,
        policy: { unverifiedRateBps: 2_000, floorCents: 2_500 },
      }),
    ).toBe(2_500);

    // Ceiling caps a large bond.
    expect(
      requiredBondCents({
        verified: false,
        fmvCents: 1_000_000,
        policy: { ceilingCents: 25_000 },
      }),
    ).toBe(25_000);
  });

  it('never exceeds the value at stake and never goes negative', () => {
    expect(
      requiredBondCents({
        verified: false,
        fmvCents: 500,
        policy: { floorCents: 10_000 },
      }),
    ).toBe(500);
    expect(requiredBondCents({ verified: false, fmvCents: 0 })).toBe(0);
    expect(requiredBondCents({ verified: false, fmvCents: -100 })).toBe(0);
  });

  it('returns whole cents for awkward rates', () => {
    const bond = requiredBondCents({
      verified: false,
      fmvCents: 3_333,
      policy: { unverifiedRateBps: 3_333 },
    });
    expect(Number.isInteger(bond)).toBe(true);
    expect(bond).toBe(1_110);
  });
});

describe('resolveTradeBonds', () => {
  const verified = { verified: true, fmvCents: 50_000 };
  const unverified = { verified: false, fmvCents: 50_000 };

  it('requires nothing when both traders are verified', () => {
    expect(resolveTradeBonds({ initiator: verified, counterpart: verified })).toEqual({
      initiatorBondCents: 0,
      counterpartBondCents: 0,
    });
  });

  it('bonds both sides when either is unverified', () => {
    expect(resolveTradeBonds({ initiator: unverified, counterpart: verified })).toEqual({
      initiatorBondCents: 50_000,
      counterpartBondCents: 50_000,
    });
    expect(resolveTradeBonds({ initiator: verified, counterpart: unverified })).toEqual({
      initiatorBondCents: 50_000,
      counterpartBondCents: 50_000,
    });
  });

  it('sizes each bond from that trader own item value', () => {
    // Guards against sizing both bonds off one item if FMVs ever differ.
    expect(
      resolveTradeBonds({
        initiator: { verified: false, fmvCents: 30_000 },
        counterpart: { verified: true, fmvCents: 40_000 },
      }),
    ).toEqual({ initiatorBondCents: 30_000, counterpartBondCents: 40_000 });
  });

  it('falls back to per-trader bonds when symmetry is disabled', () => {
    expect(
      resolveTradeBonds({ initiator: unverified, counterpart: verified, symmetric: false }),
    ).toEqual({ initiatorBondCents: 50_000, counterpartBondCents: 0 });
  });
});

describe('canPostRequiredBond', () => {
  it('lets a verified trader through with no payment instrument', () => {
    expect(
      canPostRequiredBond({ verified: true, fmvCents: 50_000, payerId: null }),
    ).toBe(true);
  });

  it('requires a payment instrument from an unverified trader', () => {
    expect(
      canPostRequiredBond({ verified: false, fmvCents: 50_000, payerId: null }),
    ).toBe(false);
    expect(
      canPostRequiredBond({ verified: false, fmvCents: 50_000, payerId: 'pyr_1' }),
    ).toBe(true);
  });
});
