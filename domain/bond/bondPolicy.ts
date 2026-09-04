// domain/bond/bondPolicy.ts
//
// The Bond Policy: how much collateral a Trader must post, given their
// verification status.
//
// THE RULE (revises Req 2.4 + 5.4). Trust is either identity or money:
//   * Verified   -> no bond. A Trader is "verified" when the Identity_Gate is
//     satisfied — a Stripe Identity document-plus-selfie check, `identity_check_status`
//     (see `domain/identity/identityGate.ts`) — so they are identifiable and pursuable
//     and trade with zero friction and zero cost.
//   * Anything else -> a bond sized from the Item's Fair_Market_Value. An
//     unverified Trader is anonymous, so the only remedy that works on the day
//     is money already in hand.
//
// SCOPE OF THE EXEMPTION. `requiredBondCents` exempts a verified party; that is
// correct for the Cash_Sale seller bond, where the Buyer's money is already
// collected and a verified Seller has nothing left to guarantee.
//
// It is NOT correct for a Trade, and `resolveTradeBonds` therefore does not apply
// it — see the note on that function. Briefly: entering trade escrow requires the
// Identity_Gate of both parties, and satisfying that Gate is what "verified" means,
// so an exemption meant every legal trade posted zero collateral and the dispute
// and fraud branches of the state machine could never fire. The justification for
// the exemption was the previous provider's charge-and-refund holds, which cost
// real money; Stripe authorisations move no funds and cost nothing to void.
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
  /**
   * The value this Trader's bond is sized against, in cents.
   *
   * NOT this Trader's own goods. On a trade every caller passes the value of what
   * this Trader RECEIVES — see `resolveTradeBonds` below, and both call sites in
   * `tradeProposal.ts`, which cross the two sides deliberately. The name is
   * historical: it predates bundles, when a side was a single paired Item and
   * "their FMV" and "what they receive" could not diverge.
   */
  fmvCents: number;
}

/**
 * Resolve both Traders' bonds for a Trade.
 *
 * NO VERIFICATION EXEMPTION ON A TRADE. Both Traders always bond, each sized from
 * the FMV of what they are receiving. This is the resolution of a recorded
 * contradiction, and it turns on a premise that has since changed:
 *
 *   * The exemption existed because holds used to be charge-and-refund on the
 *     previous provider. A bond genuinely took money out of a trader's account and
 *     cost processing fees, so exempting the honest majority was worth a lot.
 *   * Stripe exposes real authorize/void primitives. `placeHold` moves NO funds and
 *     `voidHold` costs nothing — see `domain/services/stripe/StripeService.ts`. The
 *     cost the exemption was buying off no longer exists.
 *   * Meanwhile the exemption had made the safety machinery unreachable. Entering
 *     trade escrow requires the Identity_Gate of BOTH parties, and the Gate is
 *     exactly what "verified" means here — so every trade that could legally start
 *     had two verified traders and therefore zero collateral. A Condition_Dispute
 *     had no $20 to partial-capture (Req 7.3) and an Objective_Fraud finding paid
 *     the victim nothing (Req 8.3). Both branches of the state machine were dead.
 *
 * The remaining cost to a trader is reduced available credit for the life of the
 * authorisation, which is the thing the bond is supposed to represent.
 *
 * `requiredBondCents` KEEPS its exemption, because its other caller is the
 * Cash_Sale seller bond — and there the Buyer's money is already collected, so a
 * verified Seller genuinely has nothing left to guarantee.
 */
export function resolveTradeBonds(params: {
  initiator: BondParty;
  counterpart: BondParty;
  policy?: Partial<BondPolicy>;
}): { initiatorBondCents: number; counterpartBondCents: number } {
  const { initiator, counterpart, policy } = params;

  // `verified: false` for both, deliberately: on a trade the bond is not a
  // substitute for identity, it is what makes a dispute or fraud finding payable.
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
