/// Identity Gate — the ONE verification predicate for the platform.
///
/// Mirrors `domain/identity/identityGate.ts` in the web app.
/// This gate checks ONE field only: `identityCheckStatus === 'VERIFIED'`.
/// No Connect/merchant status is involved in the gate itself.
///
/// What the gate locks:
/// - Publishing a listing
/// - Selling for cash
/// - Entering trade escrow
/// - Being a disclosed counterparty
///
/// What the gate does NOT lock:
/// - Cash buying (buyer never needs to be verified)
import '../../models/enums.dart';

/// The outcome of evaluating the identity gate for UI display.
enum VerificationState {
  /// User has not started verification.
  notStarted,

  /// Verification is in progress (Stripe Identity session open).
  inProgress,

  /// Verification was rejected/failed — user may retry.
  notApproved,

  /// User is fully verified.
  verified,
}

/// Whether the given identity check status satisfies the Identity Gate.
///
/// This is the SOLE predicate. Never re-derive this logic inline.
bool satisfiesIdentityGate(IdentityCheckStatus status) {
  return status == IdentityCheckStatus.verified;
}

/// Maps an identity check status to a member-facing verification state.
VerificationState verificationState(IdentityCheckStatus status) {
  switch (status) {
    case IdentityCheckStatus.verified:
      return VerificationState.verified;
    case IdentityCheckStatus.failed:
      return VerificationState.notApproved;
    case IdentityCheckStatus.pending:
      return VerificationState.inProgress;
    case IdentityCheckStatus.none:
      return VerificationState.notStarted;
  }
}

/// Whether to show the verified badge for this user.
/// Same as satisfiesIdentityGate — named for badge contexts.
bool showsVerifiedBadge(IdentityCheckStatus status) {
  return satisfiesIdentityGate(status);
}

/// Whether this profile can receive funds (payout setup complete).
///
/// This is independent of the Identity Gate:
/// - verified-but-unpayable is valid (hasn't done Connect onboarding yet)
/// - payable-but-unverified would be invalid (gate prevents reaching payable
///   without being verified first, but the predicates are logically independent)
///
/// Requires: merchant_status == APPROVED AND merchant_settlements_enabled
///           AND merchant_ref is not null.
bool canReceiveFunds({
  required MerchantStatus merchantStatus,
  required bool merchantSettlementsEnabled,
  required String? merchantRef,
}) {
  return merchantStatus == MerchantStatus.approved &&
      merchantSettlementsEnabled &&
      merchantRef != null;
}
