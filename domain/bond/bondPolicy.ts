// domain/bond/bondPolicy.ts
//
// The Bond Policy: how much collateral a Trader must post, given their
// verification status.
//
// THE RULE (revises Req 2.4 + 5.4). Trust is either identity or money:
//   * Verified   -> no bond. A Trader is "verified" when Managed Merchant
//     onboarding is APPROVED (`merchant_status`), so they are identifiable and
//     pursuable and trade with zero friction and zero cost.
//   * Anything else -> a bond sized from the Item's Fair_Market_Value. An
//     unverified Trader is anonymous, so the only remedy that works on the day
//     is money already in hand.
//
// Trades (including cash terms) are never blocked on verification — only the
// bond requirement changes. Cash_Sale purchase still needs an approved seller
// identity so the buyer can pay them; that is a separate gate.
//
// This replaces the previous model where EVERY Trader posted 100% of FMV and
// only verified Traders could trade at all. The change matters because holds are
// implemented as charge-and-refund on the current provider (no authorisation
// primitive), so a bond moves real money and costs real processing fees. Exempting
// verified Traders removes that cost from the overwhelming majority of honest
// trades, and makes verification something users want rather than endure.
//
// Pure module: no I/O, no provider types. All amounts are integer AUD cents.

/**
 * Tunable bond parameters. Defaults preserve the original Req 5.4 amount (100% of
 * Fair_Market_Value) for unverified Traders, so the only behavioural change is
 * the verified exemption.
 */
export interface BondPolicy {
  /**
   * Fraction of Fair_Market_Value an unverified Trader must bond, expressed in
   * basis points (10_000 = 100%). Default 10_000.
   */
  unverifiedRateBps: number;
  /** Minimum bond when a bond is required at all. Default 0 (no floor). */
  floorCents: number;
  /**
   * Maximum bond. `null` means uncapped. A cap makes high-value trades viable
   * under charge-and-refund; leave null to match the original 100%-FMV rule.
   */
  ceilingCents: number | null;
}

/** The default policy: 100% of FMV for unverified Traders, nothing for verified. */
export const DEFAULT_BOND_POLICY: BondPolicy = {
  unverifiedRateBps: 10_000,
  floorCents: 0,
  ceilingCents: null,
};

/** True when a Trader is verified and therefore bond-exempt. */
export function isBondExempt(verified: boolean): boolean {
  return verified;
}

/**
 * The bond a Trader must post for an Item of `fmvCents`.
 *
 * @returns integer cents; `0` when the Trader is verified (bond-exempt).
 */
export function requiredBondCents(params: {
  verified: boolean;
  fmvCents: number;
  policy?: Partial<BondPolicy>;
}): number {
  if (isBondExempt(params.verified)) return 0;

  const policy = { ...DEFAULT_BOND_POLICY, ...params.policy };
  const fmv = Math.max(Math.trunc(params.fmvCents), 0);
  if (fmv === 0) return 0;

  // Integer arithmetic throughout: basis points avoid floating-point drift on
  // money, and the result is floored to whole cents.
  let bond = Math.floor((fmv * policy.unverifiedRateBps) / 10_000);
  if (policy.floorCents > 0) bond = Math.max(bond, policy.floorCents);
  if (policy.ceilingCents !== null) bond = Math.min(bond, policy.ceilingCents);

  // Never require more than the value at stake.
  return Math.min(bond, fmv);
}

/** One side of a Trade, for bond resolution. */
export interface BondParty {
  verified: boolean;
  /** FMV of that Trader's OWN paired Item, in cents. */
  fmvCents: number;
}

/**
 * Resolve both Traders' bonds for a Trade.
 *
 * SYMMETRY. A bond protects the COUNTERPARTY, so sizing it purely from a
 * Trader's own status leaves the honest unverified Trader exposed to a verified
 * one who defects. With `symmetric` (the default), a bond requirement on either
 * side applies to both: verified-to-verified trades stay frictionless — which
 * preserves the incentive to verify — while no trade ever has one side carrying
 * all the risk.
 *
 * Set `symmetric: false` for per-Trader bonds sized only by their own status.
 */
export function resolveTradeBonds(params: {
  initiator: BondParty;
  counterpart: BondParty;
  policy?: Partial<BondPolicy>;
  symmetric?: boolean;
}): { initiatorBondCents: number; counterpartBondCents: number } {
  const { initiator, counterpart, policy } = params;
  const symmetric = params.symmetric ?? true;

  const initiatorOwn = requiredBondCents({ ...initiator, policy });
  const counterpartOwn = requiredBondCents({ ...counterpart, policy });

  if (!symmetric || (initiatorOwn === 0 && counterpartOwn === 0)) {
    return { initiatorBondCents: initiatorOwn, counterpartBondCents: counterpartOwn };
  }

  // Either side needs a bond -> both post one, each sized from their OWN item's
  // FMV (the equal-value guard means these match, but sizing stays per-item).
  return {
    initiatorBondCents: requiredBondCents({
      verified: false,
      fmvCents: initiator.fmvCents,
      policy,
    }),
    counterpartBondCents: requiredBondCents({
      verified: false,
      fmvCents: counterpart.fmvCents,
      policy,
    }),
  };
}

/**
 * Whether a Trader is able to enter a trade for an Item of `fmvCents`.
 *
 * A verified Trader always can. An unverified Trader can only if they have a
 * payment instrument to bond against — that instrument IS their guarantee, so
 * without it there is neither identity nor money and the trade must be refused.
 */
export function canPostRequiredBond(params: {
  verified: boolean;
  fmvCents: number;
  payerId: string | null | undefined;
  policy?: Partial<BondPolicy>;
}): boolean {
  const bond = requiredBondCents(params);
  if (bond === 0) return true;
  return Boolean(params.payerId);
}
