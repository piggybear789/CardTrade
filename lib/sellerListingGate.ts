import 'server-only';

// lib/sellerListingGate.ts
//
// ONE answer to "may this member publish a listing", for the page that renders the form
// and the action that accepts it.
//
// ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────────
//
// It was reported by the first real seller, and the report is worth quoting because it
// describes the bug exactly:
//
//     "it said complete your seller profile / but nowhere did it say seller profile as a
//      tab / i had no idea i had to fill out payment details too / my listing should've
//      been saved as a draft even if i wasn't verified yet / coz i had to go back and fill
//      in the same fields 5 times"
//
// `createItem` enforced TWO conditions — the Identity_Gate, then a buyer-safe seller
// disclosure — while `app/(workspace)/listings/new/page.tsx` checked only the FIRST before
// rendering the form. A member who had verified their identity but never submitted Connect
// onboarding therefore satisfied the render gate, was shown the whole form, photographed
// an item, wrote a description, picked a price, uploaded images, and was refused on submit.
// Req 14.7 exists to prevent precisely that, and it was half-implemented.
//
// Two conditions evaluated in two places will drift, so they are evaluated here once and
// both call sites read the result. Do NOT add a third condition to `createItem` without
// adding it here — that is the mistake this module was extracted to make impossible.
//
// ── WHY THE DISCLOSURE GAP IS PHRASED AS PAYOUT SETUP ─────────────────────────
//
// `sellerIdentityDisclosure` requires `merchant_identity_disclosure_consented_at`, and the
// SOLE writer of that column is `submitMerchantOnboarding` — the Connect payout path. The
// Stripe Identity path (`lib/identity/applyIdentityDecision.ts`) never stamps it. So a
// member verified through Identity alone has no disclosure, even though `product.md` calls
// that a normal, valid state.
//
// This means the seller's complaint was CORRECT: on this path, listing really does require
// starting payout setup. Telling them to "verify your identity" would send an
// already-verified member back to a check they have passed, and telling them to "complete
// your seller profile" names a tab that does not exist — the tabs are Profile, Verification
// and Payouts. `lib/actions/dealInvites.ts` hit this same false negative first and fixed
// its own wording; this is that fix, applied to the listing path and shared so the next
// caller inherits it.
//
// IF THE COUPLING IS EVER BROKEN — i.e. if the Identity path starts stamping its own
// consent, or the disclosure stops requiring it — the copy below becomes wrong and must
// change with it. It is wrong to describe a payout requirement that no longer exists.

import { identityGateMessage, readIdentityGate } from '@/lib/identityGate';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';

/** Which requirement is missing. Drives both the copy and the instrumentation slug. */
export type ListingGateReason = 'identity' | 'disclosure';

/** A member-facing refusal: what to say, and where to send them. */
export interface ListingGateRefusal {
  satisfied: false;
  reason: ListingGateReason;
  /** Heading for the page-level empty state. */
  title: string;
  /** The sentence shown on both the page and the submit-time toast. */
  message: string;
  /** Where the member actually resolves it. Never omitted — see the note below. */
  action: { label: string; href: string };
  /** `UX_NAMES` slug for `GateBlockedTracker`, so the two gates are distinguishable. */
  gateName: string;
}

export type ListingGateStatus = { satisfied: true } | ListingGateRefusal;

/**
 * Both gates on publishing a listing, evaluated in order and reported as one outcome.
 *
 * EVERY REFUSAL CARRIES A DESTINATION. The original `seller-not-verified` message shipped
 * a sentence and nothing else, which is how a member ended up navigating the app looking
 * for a "seller profile" that was never there. A refusal without a link is a puzzle, and a
 * member solving a puzzle is a member re-entering a form.
 *
 * Ordered identity-first because it is the genuine prerequisite: payout setup cannot be
 * completed meaningfully before the member has verified who they are, so reporting the
 * disclosure gap to someone who has not verified would send them to the second step while
 * the first is outstanding.
 */
export async function readListingGate(profileId: string): Promise<ListingGateStatus> {
  const gate = await readIdentityGate(profileId);
  if (!gate.satisfied) {
    return {
      satisfied: false,
      reason: 'identity',
      title: 'Verify your identity first',
      message: identityGateMessage('list', gate.state),
      action: { label: 'Verify identity', href: '/profile?tab=verification' },
      gateName: 'listing-identity-gate',
    };
  }

  const disclosure = await loadSellerIdentityDisclosure(profileId);
  if (!disclosure) {
    return {
      satisfied: false,
      reason: 'disclosure',
      // NAMES BOTH STEPS, because the member has done one of them and being told to
      // "verify" again reads as the app having lost their verification.
      title: 'Finish your payout setup',
      message:
        'Your identity is verified, but selling also needs payout setup finished so ' +
        'buyers can see who they are paying. Finish it under Profile → Verification.',
      action: { label: 'Finish payout setup', href: '/profile?tab=verification' },
      gateName: 'listing-disclosure-gate',
    };
  }

  return { satisfied: true };
}
