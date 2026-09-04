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
// THE GATE IS A STRIPE IDENTITY DOCUMENT CHECK: `identity_check_status =
// 'VERIFIED'`, set only when Stripe Identity accepts a government document and a
// selfie matched to it (migration 0069). A staff-confirmed fraud ban also copies
// HMAC person keys from that document onto a blocklist (0105); a later account
// matching those keys is never written VERIFIED. This predicate stays one
// column — the block happens in `applyIdentityDecision`, not here.
//
// IT USED TO BE CONNECT ONBOARDING FINISHED — `merchant_status = 'APPROVED' and
// merchant_settlements_enabled`. That was a deliberate compromise with a recorded
// exit condition: Connect enabling transfers proves the flow it hosts completed,
// but NOT that a document was ever checked, because Connect can defer document
// collection. Both steering docs called that an "accepted assurance limit" and said
// to add a real document status on top when one became available. This is that.
//
// TWO STEPS FOR A MEMBER, ONE ANSWER TO "IS THIS MEMBER VERIFIED":
//
//   1. Identity check   -> THIS gate. Unlocks listing, selling, trade access, and
//      being a disclosed counterparty. Needs no bank details.
//   2. Connect payouts  -> `canReceiveFunds`. Unlocks an actual transfer.
//
// THIS IS NOT THE RETIRED KYC SEAM RETURNING. That one was PARALLEL: `kyc_status`
// answered "verified" on some surfaces while `merchant_status` answered it on
// others, so a member could be badged verified in the rail and unverified on their
// profile. These two are SEQUENTIAL and answer DIFFERENT questions — "who is this"
// and "where does money go" — and there is still exactly one gate predicate, here.
// A member who is verified but has no payout account is verified and can list; they
// simply cannot be paid yet, and the buy surfaces already say so.
//
// MIGRATION 0060 IS THE CAUTIONARY TALE. It made the mere CREATION of a Connect
// account the verification milestone, so an empty shell read as verified: a member
// could publish listings and enter trade escrow having completed nothing, and the
// payouts card said "Verified Account" beside "Payouts incomplete" because both were
// true of one row. 0061 reversed it. The lesson that survives the move to Identity:
// if something needs to unlock on its own, give it its own predicate rather than
// widening this one.
//
// DELIBERATELY MATCHES THE DATABASE, AND THERE IS EXACTLY ONE OF EACH.
// `public_profiles.is_verified` is `identity_check_status = 'VERIFIED'`, and
// `items.seller_identity_verified` is denormalised from the same expression by
// trigger. This predicate is defined identically so the SQL and the TypeScript
// cannot drift — see the denormalisation-agreement property in
// `tests/property/identityGate.test.ts` (Req 21.6), which pins the SQL text of both
// against this function and throws on an expression it cannot interpret. That
// property did not exist when this header first claimed it, which is exactly how
// 0060 changed the SQL and left this comment describing an expression the code no
// longer implemented.
//
// Migration 0049 removed the second copy of each: the view also carried
// `identity_verified` and `items` also carried `seller_verified`, both byte-identical
// expressions maintained separately. They agreed by coincidence of having been written
// from the same source, not by construction — which is precisely the shape of the
// kyc_status/merchant_status bug that silently broke buying.
//
// NOT THE SAME AS "can be paid right now". Sending a transfer needs a provider
// destination with transfers active, which is what `canReceiveFunds` in
// `orchestrator/merchantOnboarding.ts` checks. That is a mechanical precondition for
// moving money, not a statement about identity. Use this module for gates, badges,
// filters and disclosures; use `canReceiveFunds` when about to move money.
//
// Pure module: no Supabase, no provider types, no React. Runs in the Node-only
// `domain` Vitest project. All inputs are plain data.

/** Connect onboarding state of a Profile. Mirrors the `merchant_status` enum. */
export type MerchantStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Stripe Identity check state of a Profile. Mirrors the
 * `cardtrade.identity_check_status` enum, byte for byte.
 */
export type IdentityCheckStatus = 'NONE' | 'PENDING' | 'VERIFIED' | 'FAILED';

/**
 * How far a Member has progressed through identity verification, for presentation.
 *
 * - `NOT_STARTED` — no verification session has been created.
 * - `IN_PROGRESS` — a session exists and Stripe has not accepted it yet.
 * - `NOT_APPROVED` — Stripe could not verify the document. The member may retry.
 * - `VERIFIED` — the Identity_Gate is satisfied.
 */
export type VerificationState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'NOT_APPROVED'
  | 'VERIFIED';

/**
 * The facts the gate reads. Nothing else is consulted.
 *
 * ONE FIELD, deliberately. This carried `merchantStatus` + `settlementsEnabled`
 * until 0069, when the gate moved onto a real document check. Connect state is no
 * longer an input here at all — it answers a different question
 * (`canReceiveFunds`), and leaving it on this interface would invite a surface to
 * conflate the two again.
 */
export interface IdentityGateInput {
  identityCheckStatus: IdentityCheckStatus;
}

/**
 * Whether the Identity_Gate is satisfied.
 *
 * This is the only verification predicate in the system. It gates publishing an
 * Item, selling, entering a Trade escrow, and being a disclosed counterparty
 * (Req 14.1-14.3). It deliberately does NOT gate a cash Buyer, who never receives
 * a transfer (Req 14.4).
 *
 * IT DOES NOT MEAN "can be paid". Sending money additionally needs a Connect
 * destination with transfers active — see `canReceiveFunds` in
 * `orchestrator/merchantOnboarding.ts`. The two are sequential STEPS for a member
 * and separate PREDICATES in code, which is what stops them becoming two competing
 * answers to "is this member verified".
 */
export function satisfiesIdentityGate(input: IdentityGateInput): boolean {
  return input.identityCheckStatus === 'VERIFIED';
}

/**
 * Resolve the presentational verification state.
 *
 * `FAILED` maps to `NOT_APPROVED` rather than a terminal state: a document check
 * fails for mundane reasons like a blurry photo, so the member is offered a retry.
 */
export function verificationState(input: IdentityGateInput): VerificationState {
  switch (input.identityCheckStatus) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'FAILED':
      return 'NOT_APPROVED';
    case 'PENDING':
      return 'IN_PROGRESS';
    default:
      return 'NOT_STARTED';
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
