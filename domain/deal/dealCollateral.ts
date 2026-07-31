// domain/deal/dealCollateral.ts
//
// COLLATERAL POLICY FOR PRIVATE DEALS — the deal-room application of the Bond
// Policy (`domain/bond/bondPolicy.ts`). Same rule as a 2-way trade escrow:
//
//   Trust is either identity or money.
//     * Both parties verified, no opt-in -> no collateral. "Verified" means
//       provider-approved Managed Merchant onboarding, not the standalone KYC
//       payer check, so they are identifiable, bannable and pursuable, and the
//       binding contract engages at zero cost.
//     * Either party unverified -> BOTH post collateral, sized from the deal's
//       own stake (its agreed collateral, else its cash component, else the flat
//       default).
//     * Both parties verified AND `optIn` -> BOTH post collateral anyway
//       (optional DittoEscrow for high-value meetups). Holds still go through
//       Pinch on confirm.
//
// This replaces the previous deal rule, where a deal could not be created or
// confirmed unless BOTH parties were verified. A member may now skip merchant
// onboarding and back the deal with money instead — or keep verification and
// still lock money when they choose to.
//
// SYMMETRY. Collateral protects the COUNTERPARTY, so a requirement on either
// side applies to both: the honest unverified party is never the only one with
// money at risk, and verified-to-verified deals stay frictionless by default
// (which is what keeps verification worth doing). Opt-in is also symmetric:
// either party flipping it on requires both to post.
//
// Pure module: no I/O, no Supabase, no provider types. All amounts are integer
// AUD cents.

import { requiredBondCents, type BondPolicy } from '../bond/bondPolicy';

/**
 * What the deal is worth, for collateral sizing. Mirrors the persisted columns:
 * an explicitly agreed `collateral_cents` wins, else the deal's cash component
 * (a cash deal is naturally sized by its own value), else the flat default.
 */
export interface DealCollateralBasis {
  /** `deals.collateral_cents` — the amount the parties agreed explicitly. */
  collateralCents?: number | null;
  /** `deals.cash_amount_cents` — the deal's cash component, if any. */
  cashAmountCents?: number | null;
}

/** Tunable bounds for deal collateral. Amounts are integer AUD cents. */
export interface DealCollateralPolicy {
  /** Stake used when the deal states neither collateral nor a cash amount. */
  defaultCents: number;
  /** Smallest meaningful stake — a $0 hold is not a commitment. */
  minCents: number;
  /** Largest stake a deal may size collateral from. */
  maxCents: number;
  /** Bond parameters (rate/floor/ceiling) passed through to the Bond Policy. */
  bond?: Partial<BondPolicy>;
}

/**
 * Defaults matching the tuned limits in `lib/marketplace-constants.ts`. The
 * domain never imports from `lib/`, so callers pass those constants in and this
 * stays the standalone fallback.
 */
export const DEFAULT_DEAL_COLLATERAL_POLICY: DealCollateralPolicy = {
  defaultCents: 10_000,
  minCents: 100,
  maxCents: 99_999_999_999,
};

/** Why the resolved amount is what it is — drives the room's explanation. */
export type DealCollateralReason =
  /** Both parties are verified and nobody opted into escrow. */
  | 'BOTH_VERIFIED'
  /** At least one party is unverified, so both post the stake. */
  | 'UNVERIFIED_PARTY'
  /** Both verified, but the deal opted into DittoEscrow. */
  | 'OPT_IN'
  /** Nobody has joined the share link yet; the creator alone needs nothing. */
  | 'AWAITING_JOIN';

/** The resolved collateral requirement for a deal. */
export interface DealCollateralOutcome {
  /** What a hold would be worth if one were required, in integer AUD cents. */
  stakeCents: number;
  /** What EACH party must actually post right now; `0` when exempt. */
  perPartyCents: number;
  /** True when `perPartyCents > 0`. */
  required: boolean;
  reason: DealCollateralReason;
}

/**
 * The stake a deal's collateral is sized from, clamped to the policy bounds.
 *
 * @returns integer cents, never below `minCents`.
 */
export function dealStakeCents(
  basis: DealCollateralBasis,
  policy?: Partial<DealCollateralPolicy>,
): number {
  const limits = { ...DEFAULT_DEAL_COLLATERAL_POLICY, ...policy };
  const candidate = basis.collateralCents ?? basis.cashAmountCents ?? limits.defaultCents;
  const stake =
    Number.isFinite(candidate) && candidate >= limits.minCents
      ? Math.round(candidate)
      : limits.defaultCents;
  return Math.min(Math.max(stake, limits.minCents), limits.maxCents);
}

/** Full stake bond for an unverified (or opt-in) party. */
function stakeBondCents(
  stakeCents: number,
  policy?: Partial<DealCollateralPolicy>,
): number {
  return requiredBondCents({
    verified: false,
    fmvCents: stakeCents,
    policy: policy?.bond,
  });
}

/**
 * Resolve what each party must post before a deal can become binding.
 *
 * Pass `counterparty: null` for a deal nobody has joined yet: the answer then
 * describes the CREATOR's own requirement, and `stakeCents` is what both sides
 * would post if an unverified member takes the share link (or if opt-in is on).
 */
export function resolveDealCollateral(params: {
  creator: boolean;
  counterparty: boolean | null;
  basis: DealCollateralBasis;
  /** `deals.collateral_opt_in` — force escrow even when both are verified. */
  optIn?: boolean;
  policy?: Partial<DealCollateralPolicy>;
}): DealCollateralOutcome {
  const stakeCents = dealStakeCents(params.basis, params.policy);
  const bond = params.policy?.bond;
  const optIn = Boolean(params.optIn);

  const creatorOwn = requiredBondCents({
    verified: params.creator,
    fmvCents: stakeCents,
    policy: bond,
  });

  // Unjoined: only the creator's own status is known.
  if (params.counterparty === null) {
    if (creatorOwn > 0) {
      return {
        stakeCents,
        perPartyCents: creatorOwn,
        required: true,
        reason: 'UNVERIFIED_PARTY',
      };
    }
    if (optIn) {
      const perPartyCents = stakeBondCents(stakeCents, params.policy);
      return {
        stakeCents,
        perPartyCents,
        required: perPartyCents > 0,
        reason: 'OPT_IN',
      };
    }
    return {
      stakeCents,
      perPartyCents: 0,
      required: false,
      reason: 'AWAITING_JOIN',
    };
  }

  const counterpartyOwn = requiredBondCents({
    verified: params.counterparty,
    fmvCents: stakeCents,
    policy: bond,
  });

  if (creatorOwn === 0 && counterpartyOwn === 0) {
    if (optIn) {
      const perPartyCents = stakeBondCents(stakeCents, params.policy);
      return {
        stakeCents,
        perPartyCents,
        required: perPartyCents > 0,
        reason: 'OPT_IN',
      };
    }
    return { stakeCents, perPartyCents: 0, required: false, reason: 'BOTH_VERIFIED' };
  }

  // Either side needs collateral -> both post the same stake (see SYMMETRY).
  const perPartyCents = stakeBondCents(stakeCents, params.policy);

  return {
    stakeCents,
    perPartyCents,
    required: perPartyCents > 0,
    reason: 'UNVERIFIED_PARTY',
  };
}
