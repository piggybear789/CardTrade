// tests/unit/frictionTaxAllocation.test.ts
//
// The Friction_Tax when the collateral is smaller than the tax.
//
// THE BUG THIS PINS. The tax is $20 and was captured as a literal 2000 minor units.
// Collateral is 100% of the side's value, bounded by `min(bond, fmv)`, so a trade on a
// $5 item authorises $5 — and `amount_to_capture: 2000` against a $500 authorisation is
// refused outright by Stripe as `amount_too_large`. Every condition dispute on a
// low-value trade therefore failed, froze the trade in DISPUTED with both holds locked,
// and showed the operator what looked like a transient provider error rather than a
// structural impossibility.
//
// AND THE WORSE BUG THE OBVIOUS FIX WOULD HAVE INTRODUCED. Capping the capture alone
// leaves the ALLOCATION at its constants — $10 return shipping plus $10 platform fee out
// of $5 collected — and `payReturnShippingShare` would then have paid the raiser $10 from
// $5, with the platform silently funding the difference. Money paid out that was never
// collected is a worse failure than a capture that refuses.
//
// So both halves are tested here: what may be taken, and how what WAS taken is split.

import { describe, expect, it } from 'vitest';

import {
  allocateFrictionTax,
  frictionTaxChargeableCents,
  FRICTION_TAX_CENTS,
  FRICTION_TAX_RETURN_SHIPPING_CENTS,
} from '@/domain/dispute/frictionTax';

describe('frictionTaxChargeableCents', () => {
  it('takes the full tax when the hold covers it', () => {
    expect(frictionTaxChargeableCents(10_000)).toBe(FRICTION_TAX_CENTS);
    expect(frictionTaxChargeableCents(FRICTION_TAX_CENTS)).toBe(FRICTION_TAX_CENTS);
  });

  // THE CASE THAT FAILED. A $5 trade authorises $5; the tax is what is there.
  it('caps at the authorised amount on a low-value trade', () => {
    expect(frictionTaxChargeableCents(500)).toBe(500);
    expect(frictionTaxChargeableCents(1)).toBe(1);
  });

  it('never returns a negative or fractional amount to capture', () => {
    // A provider is asked for integer minor units, and a negative capture is not a
    // refund — it is a request that would be rejected or, worse, misread.
    expect(frictionTaxChargeableCents(0)).toBe(0);
    expect(frictionTaxChargeableCents(-500)).toBe(0);
    expect(frictionTaxChargeableCents(999.7)).toBe(999);
  });
});

describe('allocateFrictionTax', () => {
  it('splits a full capture into the documented halves', () => {
    const allocation = allocateFrictionTax(FRICTION_TAX_CENTS);
    expect(allocation.returnShippingCents).toBe(1000);
    expect(allocation.platformFeeCents).toBe(1000);
  });

  // THE ORDERING DECISION. The shipping share reimburses a real cost the raising trader
  // is about to incur; the platform share is margin. On a short capture the member is
  // made whole first and the platform absorbs the shortfall.
  it('pays return shipping before the platform fee on a short capture', () => {
    const allocation = allocateFrictionTax(1200);
    expect(allocation.returnShippingCents).toBe(1000);
    expect(allocation.platformFeeCents).toBe(200);
  });

  it('gives the whole capture to return shipping when it is under the share', () => {
    const allocation = allocateFrictionTax(500);
    expect(allocation.returnShippingCents).toBe(500);
    // The platform takes NOTHING rather than taking margin ahead of a member's postage.
    expect(allocation.platformFeeCents).toBe(0);
  });

  // THE INVARIANT THAT MATTERS MOST: the platform can never pay out more than it took.
  it('always sums to exactly what was captured', () => {
    for (const captured of [0, 1, 499, 500, 999, 1000, 1001, 1999, 2000]) {
      const allocation = allocateFrictionTax(captured);
      expect(allocation.returnShippingCents + allocation.platformFeeCents).toBe(captured);
      expect(allocation.returnShippingCents).toBeGreaterThanOrEqual(0);
      expect(allocation.platformFeeCents).toBeGreaterThanOrEqual(0);
      // And the member's share is never inflated beyond the policy figure.
      expect(allocation.returnShippingCents).toBeLessThanOrEqual(
        FRICTION_TAX_RETURN_SHIPPING_CENTS,
      );
    }
  });

  it('treats a nonsensical capture as nothing collected', () => {
    const allocation = allocateFrictionTax(-100);
    expect(allocation.returnShippingCents).toBe(0);
    expect(allocation.platformFeeCents).toBe(0);
  });
});
