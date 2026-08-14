// domain/dispute/frictionTax.ts
//
// The Friction_Tax amounts, in ONE place.
//
// WHY THIS MODULE EXISTS. `FRICTION_TAX_CENTS = 2000` was declared independently in
// three files:
//
//   * `domain/orchestrator/disputeResolution.ts` — the one actually captured
//   * `domain/payouts/payoutReadModel.ts`       — drives what a member is shown
//   * `lib/actions/arbitration.ts`              — drives the "amount at risk" on the
//                                                 arbitration queue
//
// Three independent answers to one money question. Changing the captured amount would
// have left the member's payout screen and the arbitrator's triage figure quoting the
// old one, with nothing to catch it — and the arbitration queue is the surface staff
// use to decide which cases to work first.
//
// It lives in `domain/` with no dependencies so every layer can reach it: the
// orchestrator, the read model, and the action layer all import from here rather than
// from each other, which is what keeps them from forming a cycle.
//
// A NOTE ON CURRENCY. These are integer minor units and the intent is "$20". In a
// zero-decimal currency 2000 is two thousand units, not twenty — so when a second
// trading region is enabled this becomes a per-currency lookup rather than a constant.
// Recorded here because the constant is where that assumption is easiest to miss, and
// AU-only is the only reason it is currently harmless.
//
// Requirements: 7.2, 7.3.

import type { Cents } from '../services/types';

/** The fixed Friction_Tax Partial_Capture on a Condition_Dispute: $20.00 (Req 7.2). */
export const FRICTION_TAX_CENTS: Cents = 2000;

/** Friction_Tax allocation to the Counterpart for return shipping: $10.00 (Req 7.3). */
export const FRICTION_TAX_RETURN_SHIPPING_CENTS: Cents = 1000;

/** Friction_Tax allocation to the Platform_Fee: $10.00 (Req 7.3). */
export const FRICTION_TAX_PLATFORM_FEE_CENTS: Cents = 1000;

/**
 * What can actually be taken from a hold as the Friction_Tax.
 *
 * THE TAX IS $20 BUT A HOLD IS NOT ALWAYS $20. Collateral is 100% of the side's value
 * and `requiredBondCents` bounds it by `min(bond, fmv)`, so a trade on a $5 item
 * authorises $5. Requesting a $2,000-minor-unit capture against it made Stripe refuse
 * the whole thing with `amount_too_large`: the capture returned FAILED, the trade stayed
 * DISPUTED with both holds locked, and the operator saw what looked like a transient
 * provider error on every low-value dispute rather than a structural one.
 *
 * So the tax is capped at what was authorised. It cannot be "fixed" upward instead by
 * flooring the bond at $20, because that would authorise more than the goods are worth
 * and contradicts the `min(bond, fmv)` rule; and a $20 penalty on a $5 trade is
 * disproportionate anyway. A tax that cannot be collected is not a deterrent.
 */
export function frictionTaxChargeableCents(holdAmountCents: Cents): Cents {
  return Math.max(Math.min(FRICTION_TAX_CENTS, Math.trunc(holdAmountCents)), 0);
}

/**
 * Split an ACTUALLY CAPTURED Friction_Tax into its two shares.
 *
 * RETURN SHIPPING IS PAID FIRST, and that ordering is the decision this function exists
 * to record. The shipping share reimburses a real out-of-pocket cost the raising trader
 * is about to incur posting the goods back; the platform share is margin. Taking margin
 * ahead of a member's postage would be indefensible, so on a short capture the platform
 * absorbs the shortfall and the member is made whole first.
 *
 * Derived from what the provider ACTUALLY captured rather than from the constants.
 * Allocating $20 out of a $5 capture would have had `payReturnShippingShare` pay $10 to
 * the raiser from $5 collected, with the platform quietly funding the difference — a
 * worse bug than the failure it replaced, and the reason a bare `min()` at the call site
 * is not enough.
 */
export function allocateFrictionTax(capturedCents: Cents): {
  returnShippingCents: Cents;
  platformFeeCents: Cents;
} {
  const captured = Math.max(Math.trunc(capturedCents), 0);
  const returnShippingCents = Math.min(FRICTION_TAX_RETURN_SHIPPING_CENTS, captured);
  return {
    returnShippingCents,
    // The remainder, never a constant: the two shares must sum to what was captured or
    // the platform is paying out money it did not collect.
    platformFeeCents: captured - returnShippingCents,
  };
}
