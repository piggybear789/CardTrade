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
    metadata: {
      cardtrade_profile_id: params.profileId,
      // Stripe fixes `return_url` at creation, does not return it on the session, and
      // will not update it. Stamping it here is the only way a later resume can tell
      // whether the session would send the member back to THIS deployment. See
      // `sessionReturnsTo`.
      [IDENTITY_RETURN_URL_METADATA_KEY]: params.returnUrl,
    },
  };
}

/** Metadata key carrying the `return_url` a session was created with. */
export const IDENTITY_RETURN_URL_METADATA_KEY = 'cardtrade_return_url';

/**
 * Whether a session will return the member to `returnUrl`.
 *
 * WHY THIS EXISTS. Local development and production share one database, so the
 * `identity_check_session_id` on a profile may have been opened by the OTHER
 * deployment. Resuming it reuses that deployment's `return_url`, and a member testing
 * on localhost finished the hosted flow on noditto.app. A session with no stamp
 * predates the stamp and is treated as foreign, because its origin is unknowable.
 */
export function sessionReturnsTo(
  metadata: Stripe.Metadata | null | undefined,
  returnUrl: string,
): boolean {
  return metadata?.[IDENTITY_RETURN_URL_METADATA_KEY] === returnUrl;
}
