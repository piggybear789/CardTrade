// domain/services/stripe/identitySession.ts
//
// Pure helpers for Stripe Identity session creation. Extracted so session body
// and idempotency can be unit-tested without a Stripe client.

import type Stripe from 'stripe';

/**
 * Idempotency key for a verification session.
 *
 * Scoped to profile + return URL so a double-click replays the same session.
 *
 * `supersedes` widens that scope by the id of a session being REPLACED, and exists
 * because the base key is otherwise a trap: once a session is cancelled or redacted
 * the provider will accept nothing more against it, and a create under the same key
 * replays that dead session forever rather than opening the new one the caller asked
 * for. Naming the corpse in the key is what makes "start a genuinely new session"
 * expressible while keeping it deterministic — a double-clicked retry still replays
 * its own single new session instead of opening two.
 *
 * It is NOT a per-attempt nonce. A declined session is resumed rather than replaced
 * (the provider tracks failed attempts on the session), so this is reached only for
 * the dead-session case.
 */
export function identitySessionIdempotencyKey(params: {
  profileId: string;
  returnUrl: string;
  supersedes?: string | null;
}): string {
  const base = `identity:${params.profileId}:${params.returnUrl}`;
  return params.supersedes ? `${base}:after:${params.supersedes}` : base;
}

/**
 * Body for `identity.verificationSessions.create`.
 *
 * Identity is independent of Connect. Verified name/DOB/address are forwarded
 * later as `identity.individual` when the payout account is created.
 */
export function identitySessionCreateParams(params: {
  profileId: string;
  returnUrl: string;
  verificationFlow?: string;
}): Stripe.Identity.VerificationSessionCreateParams {
  return {
    ...(params.verificationFlow
      ? { verification_flow: params.verificationFlow }
      : {
          type: 'document',
          options: {
            document: {
              require_matching_selfie: true,
              require_id_number: true,
              // Gallery upload allowed. The selfie is still required and matched
              // to the document photo; live camera is not.
              require_live_capture: false,
            },
          },
        }),
    return_url: params.returnUrl,
    metadata: { cardtrade_profile_id: params.profileId },
  };
}
