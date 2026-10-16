// domain/trustedSellers/trustedSellerReview.ts
//
// Trusted Seller reviews (0152): the pure rules for how a review moves between
// statuses. A member requests one from `/trusted-sellers`; staff investigate off
// platform and decide from `/admin?tab=trusted`.
//
// TRUSTED IS NOT VERIFIED. The Identity_Gate (`domain/identity/identityGate.ts`) is a
// provider check of a document and a selfie. Trusted is a staff judgement layered on
// top of it, so approval requires identity to be verified already and never stands in
// for it. Do not fold one into the other: they are two facts with two badges.
//
// Pure: no Supabase, React or service imports.

/** Where a review stands. Mirrors the CHECK on `trusted_seller_reviews.status`. */
export type TrustedSellerReviewStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'REVOKED';

/** What a staff member can decide. */
export type TrustedSellerDecision = 'APPROVE' | 'DECLINE' | 'REVOKE';

export const TRUSTED_SELLER_DECISIONS: readonly TrustedSellerDecision[] = [
  'APPROVE',
  'DECLINE',
  'REVOKE',
];

/** Mirrors the CHECK on `trusted_seller_reviews.staff_notes`. */
export const TRUSTED_SELLER_NOTES_MAX_LENGTH = 4000;

/**
 * The status a decision moves a review to, or null when the decision does not apply.
 *
 * - APPROVE from PENDING, or reversing an earlier DECLINED / REVOKED.
 * - DECLINE only from PENDING. Taking trust away from an approved seller is REVOKE,
 *   so the record says which happened.
 * - REVOKE only from APPROVED.
 */
export function trustedSellerDecisionOutcome(
  current: TrustedSellerReviewStatus,
  decision: TrustedSellerDecision,
): TrustedSellerReviewStatus | null {
  switch (decision) {
    case 'APPROVE':
      return current === 'APPROVED' ? null : 'APPROVED';
    case 'DECLINE':
      return current === 'PENDING' ? 'DECLINED' : null;
    case 'REVOKE':
      return current === 'APPROVED' ? 'REVOKED' : null;
    default:
      return null;
  }
}

/** Narrow an untrusted decision string. */
export function asTrustedSellerDecision(value: unknown): TrustedSellerDecision | null {
  return typeof value === 'string' &&
    (TRUSTED_SELLER_DECISIONS as readonly string[]).includes(value)
    ? (value as TrustedSellerDecision)
    : null;
}

/** What approval needs from the member's account. */
export interface TrustedSellerEligibility {
  identityVerified: boolean;
  fraudBanned: boolean;
  closed: boolean;
}

/**
 * Why a member cannot be approved, or null when they can. The database trigger on
 * `trusted_seller_reviews` enforces the same three conditions.
 */
export function trustedSellerApprovalBlocker(
  account: TrustedSellerEligibility,
): 'identity-unverified' | 'account-suspended' | 'account-closed' | null {
  if (account.fraudBanned) return 'account-suspended';
  if (account.closed) return 'account-closed';
  if (!account.identityVerified) return 'identity-unverified';
  return null;
}
