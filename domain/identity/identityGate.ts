// domain/identity/identityGate.ts
//
// The Identity_Gate — the single verification signal in CardTrade (Req 13).
//
// WHY THIS EXISTS. The app used to carry two competing definitions of "verified":
// `kyc_status`, a payer identity check, and `merchant_status`, Stripe Connect
// payee onboarding. `KycRailStatus` asserted verification was the second while
// `profile/page.tsx` rendered the first as a peer, so a Member could be badged
// verified on one surface and unverified on another. This module is the one place
// that answers the question, so every surface answers it the same way.
//
// THE GATE. Connect onboarding APPROVED *and* settlements enabled. Approval alone
// is not enough: `stripe_transfers.status === 'active'` is the only provider
// signal that means money can actually arrive, and it is what promotes
// `merchant_status` to APPROVED with `merchant_settlements_enabled` true.
//
// DELIBERATELY MATCHES THE DATABASE, AND THERE IS NOW EXACTLY ONE OF EACH.
// `public_profiles.is_verified` is `merchant_status = 'APPROVED' and
// merchant_settlements_enabled`, and `items.seller_identity_verified` is denormalised
// from the same expression by trigger. This predicate is defined identically so the SQL
// and the TypeScript cannot drift — see the denormalisation-agreement property
// (Req 21.6).
//
// Migration 0049 removed the second copy of each: the view also carried
// `identity_verified` and `items` also carried `seller_verified`, both byte-identical
// expressions maintained separately. They agreed by coincidence of having been written
// from the same source, not by construction — which is precisely the shape of the
// kyc_status/merchant_status bug that silently broke buying.
//
// NOT THE SAME AS "can be paid right now". Sending a transfer additionally needs
// a provider destination, which is why `canReceiveFunds` in
// `orchestrator/merchantOnboarding.ts` also requires `merchantRef`. That is a
// mechanical precondition for a transfer, not a statement about identity. Use
// this module for gates, badges, filters and disclosures; use `canReceiveFunds`
// when about to move money.
//
// Pure module: no Supabase, no provider types, no React. Runs in the Node-only
// `domain` Vitest project. All inputs are plain data.

/** Connect onboarding state of a Profile. Mirrors the `merchant_status` enum. */
export type MerchantStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * How far a Member has progressed through verification, for presentation.
 *
 * - `NOT_STARTED` — no Connect onboarding has been submitted.
 * - `IN_PROGRESS` — submitted and awaiting the provider, *or* approved without
 *   settlements enabled, which is not yet payable and must never read as
 *   verified (Req 13.2).
 * - `NOT_APPROVED` — the provider declined.
 * - `VERIFIED` — the Identity_Gate is satisfied.
 */
export type VerificationState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'NOT_APPROVED'
  | 'VERIFIED';

/** The Connect facts the gate reads. Nothing else is consulted. */
export interface IdentityGateInput {
  merchantStatus: MerchantStatus;
  /** True only when the provider reports `stripe_transfers.status === 'active'`. */
  settlementsEnabled: boolean;
}

/**
 * Whether the Identity_Gate is satisfied.
 *
 * This is the only verification predicate in the system. It gates publishing an
 * Item for cash sale, entering a Trade escrow, and creating or joining a
 * cash-bearing private deal (Req 14.1-14.3). It deliberately does NOT gate a cash
 * Buyer, who never receives a transfer (Req 14.4).
 */
export function satisfiesIdentityGate(input: IdentityGateInput): boolean {
  return input.merchantStatus === 'APPROVED' && input.settlementsEnabled;
}

/**
 * Resolve the presentational verification state.
 *
 * Note that APPROVED-without-settlements collapses to `IN_PROGRESS` rather than
 * getting its own state: from the Member's point of view there is one thing left
 * to happen, and surfacing "approved but not payable" as a distinct status is how
 * the two-gate confusion started.
 */
export function verificationState(input: IdentityGateInput): VerificationState {
  if (satisfiesIdentityGate(input)) return 'VERIFIED';

  switch (input.merchantStatus) {
    case 'REJECTED':
      return 'NOT_APPROVED';
    case 'NONE':
      return 'NOT_STARTED';
    // PENDING, and APPROVED without settlements enabled.
    default:
      return 'IN_PROGRESS';
  }
}

/**
 * Whether a verified badge may be shown.
 *
 * A separate named export from {@link satisfiesIdentityGate} so that badge
 * surfaces read as badge surfaces, while both provably answer from one source
 * (Req 13.3, Req 21.2).
 */
export function showsVerifiedBadge(input: IdentityGateInput): boolean {
  return satisfiesIdentityGate(input);
}
