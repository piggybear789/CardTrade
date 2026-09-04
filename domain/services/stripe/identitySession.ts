// domain/services/stripe/identitySession.ts
//
// Pure helpers for Stripe Identity session creation. Extracted so session body
// and idempotency can be unit-tested without a Stripe client.

import type Stripe from 'stripe';

/**
 * Idempotency key for a verification session.
 *
 * Scoped to profile + return URL so a double-click replays the same session.
 */
export function identitySessionIdempotencyKey(params: {
  profileId: string;
  returnUrl: string;
}): string {
  return `identity:${params.profileId}:${params.returnUrl}`;
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
