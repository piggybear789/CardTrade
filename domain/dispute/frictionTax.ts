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
