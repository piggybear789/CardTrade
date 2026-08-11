/// Bond (Collateral) Policy — who needs a bond and how much.
///
/// Mirrors `domain/bond/bondPolicy.ts` in the web app.
///
/// CRITICAL RULE: Trade bonds are NEVER exempt. Both traders bond
/// regardless of verification status. The exemption applies ONLY to
/// Cash_Sale seller bonds, where the Buyer's money is already collected.
import 'dart:math' as math;

/// Policy parameters for bond sizing.
class BondPolicy {
  const BondPolicy({
    this.unverifiedRateBps = 10000,
    this.floorCents = 0,
    this.ceilingCents,
  });

  /// Rate in basis points for unverified parties. Default 100% (10000 bps).
  final int unverifiedRateBps;

  /// Minimum bond amount in cents.
  final int floorCents;

  /// Maximum bond amount in cents, or null for uncapped.
  final int? ceilingCents;

  static const BondPolicy defaultPolicy = BondPolicy();
}

/// Whether a party is exempt from a Cash_Sale seller bond.
///
/// Only verified sellers are exempt from cash sale bonds — their
/// exemption exists because the Buyer's money is already collected.
/// This is NEVER used for trade bonds.
bool isCashSaleBondExempt(bool verified) => verified;

/// Calculates the required bond in cents for a Cash_Sale seller.
///
/// Returns 0 if the seller is verified (exempt).
/// For trades, use [requiredTradeBondCents] which never exempts.
int requiredCashSaleBondCents({
  required bool verified,
  required int fmvCents,
  BondPolicy policy = BondPolicy.defaultPolicy,
}) {
  if (isCashSaleBondExempt(verified)) return 0;
  return _calculateBond(fmvCents, policy);
}

/// Calculates required trade collateral for ONE trader.
///
/// Trade bonds are NEVER exempt regardless of verification.
/// Each trader bonds against the FMV of what they are RECEIVING
/// (the other party's goods value).
int requiredTradeBondCents({
  required int valueCents,
  BondPolicy policy = BondPolicy.defaultPolicy,
}) {
  return _calculateBond(valueCents, policy);
}

/// Resolves bond amounts for both parties in a trade.
///
/// ALWAYS passes verified: false for BOTH parties — trade bonds
/// are never exempt. A Stripe authorisation moves no funds and
/// costs nothing to void, so there is no justification for
/// exempting verified traders from collateral.
({int initiatorBondCents, int counterpartBondCents}) resolveTradeBonds({
  required int initiatorSideCents,
  required int counterpartSideCents,
  BondPolicy policy = BondPolicy.defaultPolicy,
}) {
  // Each trader bonds the VALUE of what the OTHER side offers
  // (i.e. what they stand to receive).
  return (
    initiatorBondCents: requiredTradeBondCents(
      valueCents: counterpartSideCents,
      policy: policy,
    ),
    counterpartBondCents: requiredTradeBondCents(
      valueCents: initiatorSideCents,
      policy: policy,
    ),
  );
}

/// Whether a user can post the required bond for trade escrow.
///
/// A saved card (payerId) is a hard prerequisite for trade escrow.
bool canPostRequiredBond({
  required int valueCents,
  required String? payerId,
  BondPolicy policy = BondPolicy.defaultPolicy,
}) {
  final required = requiredTradeBondCents(valueCents: valueCents, policy: policy);
  if (required == 0) return true;
  return payerId != null;
}

// ─── Internal ────────────────────────────────────────────────────────────────

int _calculateBond(int fmvCents, BondPolicy policy) {
  final fmv = math.max(fmvCents, 0);
  if (fmv == 0) return 0;

  // Integer arithmetic: floor(fmv * bps / 10000)
  int bond = (fmv * policy.unverifiedRateBps) ~/ 10000;

  // Clamp to floor
  bond = math.max(bond, policy.floorCents);

  // Clamp to ceiling
  if (policy.ceilingCents != null) {
    bond = math.min(bond, policy.ceilingCents!);
  }

  // Bond never exceeds the value at stake
  bond = math.min(bond, fmv);

  return bond;
}
