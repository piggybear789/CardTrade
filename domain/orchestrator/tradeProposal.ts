// domain/orchestrator/tradeProposal.ts
//
// Trade proposal + collateral logic for the 2-Way Trade escrow (Req 5 + the
// bond-exemption gate of Req 2.4). Like `tradeOrchestrator.ts`, this module is
// the coordination layer that combines validation, persistence, and payment
// side effects — but it depends only on *interfaces* (a
// `TradeProposalRepository` for data access and the `PaymentService` for
// holds/voids) so it stays exhaustively testable against an in-memory fake. The
// concrete Supabase admin binding lives in `supabaseTradeProposalRepository.ts`,
// which is the only file that pulls in `server-only`.
//
// Responsibilities (task 7.4):
//   * proposeTrade — guard that both paired Items are AVAILABLE (Req 5.1, 5.3);
//     on success create a Trade in COLLATERAL_PENDING, set both Items to
//     RESERVED (Req 5.1), and place a bond for each Trader who requires one per
//     the Bond Policy (`domain/bond/bondPolicy.ts`): each Trader bonds the value
//     of what they RECEIVE, not what they give (revised Req 2.4, 5.4). There is
//     no verification exemption on a trade — `resolveTradeBonds` bonds both sides
//     regardless, because the bond is what makes a dispute or fraud finding
//     payable. Trading is never blocked by verification.
//   * createCollateralSideEffects — a `RunSideEffects` hook for the guarded
//     transition core: on HOLDS_FAILED it cancels the Trade by voiding any
//     active holds and restoring both Items to AVAILABLE (Req 5.6). The
//     HOLDS_CONFIRMED -> COLLATERAL_LOCKED transition itself is performed by the
//     state-machine core (`applyEvent`) and needs no payment side effect.
//
// All monetary amounts are integer AUD cents.

import type { PaymentService, PreAuthHold } from '../services/types';
import { resolveTradeBonds, type BondPolicy } from '../bond/bondPolicy';
import { resolveTradeSideValues, tradeSidesAreValued } from '../trade/tradeSideValues';
import type { RunSideEffects, TradeRecord } from './tradeOrchestrator';

// ---------------------------------------------------------------------------
// Data-access seam (implemented by the Supabase admin binding + test fakes)
// ---------------------------------------------------------------------------

/** Availability status of an Item, mirroring the `item_status` enum. */
export type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

/** The Profile fields the proposal flow needs: the bond-exemption gate + payer reference. */
export interface ProfileRecord {
  id: string;
  /** True when Managed Merchant identity is APPROVED (`merchant_status`). */
  verified: boolean;
  /** Provider payer reference used to place a Bond hold when not exempt (Req 5.4). */
  payerId: string | null;
}

/** The Item fields the proposal flow needs: ownership, value, availability. */
export interface ItemRecord {
  id: string;
  ownerId: string;
  /** Fair_Market_Value in integer AUD cents. Used to size bonds, not to gate acceptance. */
  fmvCents: number;
  status: ItemStatus;
  /**
   * SINGLE or SHOPFRONT (0064).
   *
   * Load-bearing for money: a SHOPFRONT's `fmvCents` is an indicative "from" price
   * for a whole inventory, so it must never be summed into a side value. See
   * `resolveTradeSideValues`. Optional so an older repository that does not select
   * the column still type-checks; it then reads as SINGLE, which is what every
   * pre-0064 row is.
   */
  listingKind?: 'SINGLE' | 'SHOPFRONT';
}

/** Parameters for creating the Trade aggregate (Req 5.1). */
export interface CreateTradeParams {
  initiatorId: string;
  counterpartId: string;
  initiatorItemId: string;
  counterpartItemId: string;
}

/** A Pre_Auth_Hold to persist against a Trade (one per Trader). */
export interface HoldRecordInput {
  tradeId: string;
  traderId: string;
  /** Provider-side hold reference returned by `PaymentService.placeHold`. */
  holdRef: string;
  amountCents: number;
  status: PreAuthHold['status'];
  /**
   * When the provider authorisation lapses, from {@link PreAuthHold.expiresAt}.
   *
   * MUST be persisted. After this instant the provider releases the collateral
   * itself, so a void or capture will fail and the escrow guarantee is gone.
   * Absent for providers whose holds do not expire (the mock).
   */
  expiresAt?: string;
}

/** A persisted Pre_Auth_Hold row (as read back for cancellation). */
export interface RecordedHold {
  tradeId: string;
  traderId: string;
  holdRef: string;
  amountCents: number;
  status: PreAuthHold['status'];
}

/**
 * Data-access seam for trade proposal + collateral. Backed by the Supabase
 * admin client in production (`supabaseTradeProposalRepository.ts`) and by an
 * in-memory fake in tests. All writes go through the trusted service-role path
 * because a valid proposal must reserve items and record holds atomically with
 * the Trade creation.
 */
export interface TradeProposalRepository {
  /** Load a Profile (KYC status + payer), or `null` if it does not exist. */
  getProfile(profileId: string): Promise<ProfileRecord | null>;
  /** Load an Item (owner + FMV + availability), or `null` if it does not exist. */
  getItem(itemId: string): Promise<ItemRecord | null>;
  /** Create the Trade aggregate in COLLATERAL_PENDING (Req 5.1). */
  createTrade(params: CreateTradeParams): Promise<TradeRecord>;
  /** Set the given Items' availability to RESERVED (Req 5.1). */
  reserveItems(itemIds: string[]): Promise<void>;
  /** Restore the given Items' availability to AVAILABLE (Req 5.6). */
  restoreItems(itemIds: string[]): Promise<void>;
  /** Persist a Pre_Auth_Hold row for a Trade (Req 5.4). */
  recordHold(hold: HoldRecordInput): Promise<void>;
  /** Read all Pre_Auth_Holds for a Trade, oldest first (used to void on cancellation). */
  getHolds(tradeId: string): Promise<RecordedHold[]>;
  /**
   * Every Item on the Trade, including extras on `trade_items`. HOLDS_FAILED must
   * restore the bundle, not only the two primary ids on the Trade row.
   */
  listTradeItemIds(tradeId: string): Promise<string[]>;
  /** Update a persisted hold's status (e.g. to VOIDED on cancellation, Req 5.6). */
  markHoldStatus(holdRef: string, status: PreAuthHold['status']): Promise<void>;
}

// ---------------------------------------------------------------------------
// proposeTrade
// ---------------------------------------------------------------------------

/**
 * Typed failure codes for {@link proposeTrade}. None of these leave the system
 * mutated: every guard runs before any Trade creation / item reservation.
 * - `profile-not-found`  — the proposing Trader has no Profile.
 * - `not-verified`       — reserved; a Trader may propose while unverified as
 *   long as they can post a Bond (Req 2.4). Kept in the union for exhaustive
 *   error mapping at the action boundary.
 * - `item-not-found`     — one of the paired Items does not exist.
 * - `not-owner`          — the proposer does not own the Item they offered.
 * - `item-unavailable`   — a paired Item's status is not AVAILABLE (Req 5.3).
 * - `payer-not-found`    — a Trader has no payer reference to place a hold against.
 *
 * NOTE: there is deliberately no `unequal-value` guard here. Trades may be
 * bundles plus cash with a self-declared value; the Counterpart's acceptance is
 * what agrees the exchange, not a system appraisal (Req 5.2, revised). Equal-FMV
 * pairing was the pre-bundle rule and no longer applies at this layer.
 */
export type ProposeTradeError =
  | 'profile-not-found'
  | 'not-verified'
  | 'item-not-found'
  | 'not-owner'
  | 'item-unavailable'
  | 'payer-not-found';

/**
 * Discriminated result of a trade proposal.
 *
 * `bondsRequired` is the number of Traders who had to post a bond. When it is
 * `0` there is no provider event coming to drive HOLDS_CONFIRMED, so the caller
 * must dispatch that event itself to move the Trade from COLLATERAL_PENDING to
 * COLLATERAL_LOCKED. That happens only when both side values are zero —
 * verification does NOT exempt a Trader from a trade bond.
 */
export type ProposeTradeResult =
  | { ok: true; trade: TradeRecord; bondsRequired: number }
  | { ok: false; error: ProposeTradeError; detail?: string };

/** Dependencies for the proposal flow. */
export interface TradeProposalDeps {
  repository: TradeProposalRepository;
  /** Injected payment provider used to place bonds (Req 5.4). */
  payments: PaymentService;
  /** Bond sizing overrides; defaults to {@link DEFAULT_BOND_POLICY}. */
  bondPolicy?: Partial<BondPolicy>;
}

/** Inputs identifying the proposer and the two paired Items. */
export interface ProposeTradeParams {
  /** The proposing Trader (the initiator); must own `initiatorItemId`. */
  proposerId: string;
  /** The initiator's own Item being offered. */
  initiatorItemId: string;
  /**
   * Further Items in the initiator's bundle. They are reserved with the primary
   * Item and, crucially, counted into the Counterpart's Bond: the Counterpart
   * receives the whole bundle, so their collateral must cover all of it.
   */
  initiatorExtraItemIds?: string[];
  /** The Counterpart's Item requested in exchange. */
  counterpartItemId: string;
}

/** Deterministic hold reference for a Trader's collateral on a Trade. */
function holdRef(tradeId: string, traderId: string, attempt = 1): string {
  // Attempt 1 keeps the historical key so a first placement is unchanged.
  // Later attempts MUST be a new Stripe idempotency key: reusing the first one
  // for 24 hours replays the original decline even after the trader swaps card.
  return attempt <= 1 ? `hold:${tradeId}:${traderId}` : `hold:${tradeId}:${traderId}:${attempt}`;
}

/**
 * The latest hold row per trader. Older FAILED/VOIDED rows stay on file so a
 * retry can pick a new attempt number; sync and confirm must ignore them or a
 * successful retry would still look failed.
 */
export function currentHoldsByTrader(holds: RecordedHold[]): RecordedHold[] {
  const latest = new Map<string, RecordedHold>();
  for (const hold of holds) {
    latest.set(hold.traderId, hold);
  }
  return [...latest.values()];
}

/** True when the latest hold for every recorded trader is ACTIVE. */
export function currentHoldsAreActive(holds: RecordedHold[]): boolean {
  const current = currentHoldsByTrader(holds);
  return current.length > 0 && current.every((hold) => hold.status === 'ACTIVE');
}

/** True when the latest hold for any trader is a finished-and-failed seek. */
export function currentHoldsSeekFailed(holds: RecordedHold[]): boolean {
  return currentHoldsByTrader(holds).some(
    (hold) =>
      hold.status === 'FAILED' || hold.status === 'VOIDED' || hold.status === 'EXPIRED',
  );
}

/**
 * Propose a 2-Way Trade (Req 2.4, 5.1, 5.3, 5.4).
 *
 * Validation runs entirely before any mutation, so a rejected proposal leaves
 * both Items' availability unchanged (Req 5.3):
 *   1. The proposing Trader must have a Profile.
 *   2. Both paired Items must exist, the proposer must own the Item they offer,
 *      and both Items must be AVAILABLE (Req 5.3).
 *   3. Both Traders must have a payer reference to place a hold against (Req 5.4).
 *
 * On success it creates a Trade in COLLATERAL_PENDING, reserves both Items
 * (Req 5.1), and requests a Pre_Auth_Hold sized at 100% of what each Trader
 * RECEIVES, against that Trader's payment instrument (Req 5.4). The active /
 * failed outcome of each hold is later reported via a Webhook_Event that drives
 * HOLDS_CONFIRMED / HOLDS_FAILED through the guarded transition core.
 */
export async function proposeTrade(
  deps: TradeProposalDeps,
  params: ProposeTradeParams,
): Promise<ProposeTradeResult> {
  const { repository, payments } = deps;

  // 1. The proposing Trader must have a Profile. Verification is NOT required to
  //    trade any more: an unverified Trader may trade if they can post a bond
  //    (checked in step 4 once the Item value is known).
  const proposer = await repository.getProfile(params.proposerId);
  if (!proposer) {
    return { ok: false, error: 'profile-not-found' };
  }

  // 2. Both Items must exist.
  const [initiatorItem, counterpartItem] = await Promise.all([
    repository.getItem(params.initiatorItemId),
    repository.getItem(params.counterpartItemId),
  ]);
  if (!initiatorItem || !counterpartItem) {
    return { ok: false, error: 'item-not-found' };
  }

  // The proposer must own the Item they are offering.
  if (initiatorItem.ownerId !== params.proposerId) {
    return { ok: false, error: 'not-owner' };
  }

  // Both paired Items must be AVAILABLE; otherwise reject and leave unchanged (Req 5.3).
  if (initiatorItem.status !== 'AVAILABLE' || counterpartItem.status !== 'AVAILABLE') {
    return { ok: false, error: 'item-unavailable' };
  }

  // NOT guarded here: that the two primary Items are equal in value. A side can
  // be a bundle plus cash with a self-declared value that no system appraisal
  // can compare to a single listing price; the Counterpart's acceptance (at the
  // proposal-request layer, `tradeProposalRequest.ts`) is what agrees the
  // exchange (Req 5.2, revised).

  // 3. BOND GATE. Each Trader's collateral requirement comes from the Bond
  //    Policy: a Trader with APPROVED merchant identity is exempt, everyone else
  //    bonds against the value of what they RECEIVE. An unverified Trader with
  //    no payment instrument has neither identity nor money behind the trade, so
  //    the proposal is refused — but trading itself is never blocked outright.
  const counterpartId = counterpartItem.ownerId;
  const counterpartProfile = await repository.getProfile(counterpartId);
  if (!counterpartProfile) {
    return { ok: false, error: 'profile-not-found' };
  }

  // Bonds are SYMMETRIC by default: if either Trader is unverified, BOTH post a
  // bond, so the honest unverified Trader is never the only one with money at
  // risk. Verified-to-verified trades require nothing from either side.
  //
  // Each side is sized on the TOTAL VALUE that Trader RECEIVES, not what they
  // give. The deposit has to cover every item now in that Trader's hands, and a
  // Trader must never be able to shrink their own exposure by understating their
  // own side — which matters now that a side can be a bundle with a self-declared
  // value.
  const extraItemIds = (params.initiatorExtraItemIds ?? []).filter(
    (id) => id && id !== params.initiatorItemId,
  );
  const extraItems = await Promise.all(extraItemIds.map((id) => repository.getItem(id)));
  if (extraItems.some((entry) => !entry)) {
    return { ok: false, error: 'item-not-found' };
  }
  if (extraItems.some((entry) => entry!.ownerId !== params.proposerId)) {
    return { ok: false, error: 'not-owner' };
  }
  if (extraItems.some((entry) => entry!.status !== 'AVAILABLE')) {
    return { ok: false, error: 'item-unavailable' };
  }

  // What each Trader receives. The binder rule lives in `resolveTradeSideValues`
  // and is applied here as well as on the negotiated path, because summing a
  // SHOPFRONT's `fmvCents` would bond a whole inventory.
  const { initiatorSideCents, counterpartSideCents } = resolveTradeSideValues({
    initiatorGoodsCents: extraItems.reduce(
      (sum, entry) => sum + (entry?.fmvCents ?? 0),
      initiatorItem.fmvCents,
    ),
    counterpartGoodsCents: counterpartItem.fmvCents,
    counterpartIsShopfront: counterpartItem.listingKind === 'SHOPFRONT',
  });

  const { initiatorBondCents: proposerBond, counterpartBondCents: counterpartBond } =
    resolveTradeBonds({
      initiator: { verified: proposer.verified, fmvCents: counterpartSideCents },
      counterpart: { verified: counterpartProfile.verified, fmvCents: initiatorSideCents },
      policy: deps.bondPolicy,
    });

  if ((proposerBond > 0 && !proposer.payerId) || (counterpartBond > 0 && !counterpartProfile.payerId)) {
    return { ok: false, error: 'payer-not-found' };
  }

  // --- Mutations: create the Trade, reserve both Items (Req 5.1). ---
  const trade = await repository.createTrade({
    initiatorId: params.proposerId,
    counterpartId,
    initiatorItemId: params.initiatorItemId,
    counterpartItemId: params.counterpartItemId,
  });
  await repository.reserveItems([
    params.initiatorItemId,
    ...extraItemIds,
    params.counterpartItemId,
  ]);

  // Place a bond for each Trader who requires one, sized from what that Trader
  // RECEIVES — the crossed arguments to `resolveTradeBonds` above are deliberate.
  // A zero bond places no hold, which here means a side valued at nothing rather
  // than a verified Trader: trade bonds have no verification exemption.
  const holdPlacements = [
    {
      traderId: params.proposerId,
      payerId: proposer.payerId,
      amountCents: proposerBond,
    },
    {
      traderId: counterpartId,
      payerId: counterpartProfile.payerId,
      amountCents: counterpartBond,
    },
  ].filter(
    (placement): placement is { traderId: string; payerId: string; amountCents: number } =>
      placement.amountCents > 0 && Boolean(placement.payerId),
  );

  for (const placement of holdPlacements) {
    const hold = await payments.placeHold({
      payerId: placement.payerId,
      amount: placement.amountCents,
      ref: holdRef(trade.id, placement.traderId),
    });
    await repository.recordHold({
      tradeId: trade.id,
      traderId: placement.traderId,
      holdRef: hold.holdId,
      amountCents: placement.amountCents,
      status: hold.status,
      expiresAt: hold.expiresAt,
    });
  }

  // With no bonds there is no provider event to drive HOLDS_CONFIRMED, so the
  // caller must dispatch it (see `ProposeTradeResult.bondsRequired`).
  return { ok: true, trade, bondsRequired: holdPlacements.length };
}

// ---------------------------------------------------------------------------
// Bonds for an already-agreed Trade (negotiation flow)
// ---------------------------------------------------------------------------

/** Which bundle each Trader is giving up, by Item id. */
export interface AgreedTradeBundles {
  tradeId: string;
  initiatorId: string;
  counterpartId: string;
  /** Items the COUNTERPART receives, so they size the counterpart's bond. */
  initiatorItemIds: string[];
  /** Items the INITIATOR receives, so they size the initiator's bond. */
  counterpartItemIds: string[];
}

export type PlaceAgreedBondsResult =
  | { ok: true; bondsRequired: number }
  | {
      ok: false;
      error:
        | 'profile-not-found'
        | 'item-not-found'
        | 'payer-not-found'
        /**
         * A side is worth nothing, so there is no figure to collateralise against.
         * Reachable on a binder trade, whose side inherits its value from the other
         * one (0081) — see `tradeSidesAreValued`.
         */
        | 'side-unvalued'
        /**
         * The provider refused at least one collateral authorisation — typically a
         * card decline. Reported as a FAILURE so the caller runs the HOLDS_FAILED
         * compensation before anything is billed; see the note in the placement loop.
         */
        | 'hold-failed';
    };

/**
 * Size and place both Traders' bonds on a Trade that ALREADY EXISTS and whose
 * terms both sides have accepted.
 *
 * Split out of {@link proposeTrade} rather than copied: that function creates the
 * Trade, reserves the Items and places the bonds in one step, which suits an
 * offer that is accepted in a single click. In the negotiated flow the Trade and
 * the reservation are done by `begin_trade_collateral` in SQL, so only the money
 * half is wanted here. Duplicating bond sizing would be duplicating the Bond
 * Policy, which is exactly the kind of second answer that produced the
 * trade/deal divergence in the first place.
 *
 * Bond sizing is unchanged: each Trader bonds against the FMV of what they
 * RECEIVE, and the Bond Policy decides who is exempt.
 */
export async function placeBondsForAgreedTrade(
  deps: TradeProposalDeps,
  params: AgreedTradeBundles,
): Promise<PlaceAgreedBondsResult> {
  const { repository, payments } = deps;

  const [initiator, counterpart] = await Promise.all([
    repository.getProfile(params.initiatorId),
    repository.getProfile(params.counterpartId),
  ]);
  if (!initiator || !counterpart) return { ok: false, error: 'profile-not-found' };

  const loadSide = async (
    itemIds: string[],
  ): Promise<{ goodsCents: number; hasShopfront: boolean } | null> => {
    const items = await Promise.all(itemIds.map((id) => repository.getItem(id)));
    if (items.some((item) => item === null)) return null;
    return {
      goodsCents: items.reduce((sum, item) => sum + (item?.fmvCents ?? 0), 0),
      hasShopfront: items.some((item) => item?.listingKind === 'SHOPFRONT'),
    };
  };

  const [initiatorSide, counterpartSide] = await Promise.all([
    loadSide(params.initiatorItemIds),
    loadSide(params.counterpartItemIds),
  ]);
  if (!initiatorSide || !counterpartSide) {
    return { ok: false, error: 'item-not-found' };
  }

  const sides = resolveTradeSideValues({
    initiatorGoodsCents: initiatorSide.goodsCents,
    counterpartGoodsCents: counterpartSide.goodsCents,
    counterpartIsShopfront: counterpartSide.hasShopfront,
  });
  // A binder side inherits its value from the other side, so a bundle worth nothing
  // would collateralise a trade at zero — escrow with nothing behind it. Refused
  // rather than confirmed as "no bond needed".
  if (!tradeSidesAreValued(sides)) {
    return { ok: false, error: 'side-unvalued' };
  }
  const { initiatorSideCents, counterpartSideCents } = sides;

  const { initiatorBondCents, counterpartBondCents } = resolveTradeBonds({
    initiator: { verified: initiator.verified, fmvCents: counterpartSideCents },
    counterpart: { verified: counterpart.verified, fmvCents: initiatorSideCents },
    policy: deps.bondPolicy,
  });

  if (
    (initiatorBondCents > 0 && !initiator.payerId) ||
    (counterpartBondCents > 0 && !counterpart.payerId)
  ) {
    return { ok: false, error: 'payer-not-found' };
  }

  const placements = [
    { traderId: params.initiatorId, payerId: initiator.payerId, amountCents: initiatorBondCents },
    { traderId: params.counterpartId, payerId: counterpart.payerId, amountCents: counterpartBondCents },
  ].filter(
    (p): p is { traderId: string; payerId: string; amountCents: number } =>
      p.amountCents > 0 && Boolean(p.payerId),
  );

  let anyHoldFailed = false;
  const existing = await repository.getHolds(params.tradeId);

  for (const placement of placements) {
    const attempt =
      existing.filter((hold) => hold.traderId === placement.traderId).length + 1;
    const deterministicRef = holdRef(params.tradeId, placement.traderId, attempt);
    const hold = await payments.placeHold({
      payerId: placement.payerId,
      amount: placement.amountCents,
      // First placement keeps `hold:<trade>:<trader>` so a retry of the SAME
      // request cannot double-authorise. A later attempt after a decline MUST
      // use a new key — Stripe caches the original decline against the first
      // one for 24 hours, even if the trader has swapped cards.
      ref: deterministicRef,
    });
    if (hold.status !== 'ACTIVE') anyHoldFailed = true;
    await repository.recordHold({
      tradeId: params.tradeId,
      traderId: placement.traderId,
      // A FAILED placement comes back with an EMPTY `holdId`. Recording that
      // verbatim gave both traders' failed rows the same blank ref, so the
      // compensation path's per-ref lookups matched nothing (and `voidHold('')`
      // acted on nothing). The deterministic ref keeps the rows distinguishable and
      // is the same value the provider was asked to key on.
      holdRef: hold.holdId || deterministicRef,
      amountCents: placement.amountCents,
      status: hold.status,
      expiresAt: hold.expiresAt,
    });
  }

  // A DECLINE IS A FAILURE, AND SAYING OTHERWISE COST BOTH TRADERS THE FEE.
  //
  // This used to return `ok: true` whatever the provider said, because the hold
  // rows had been written and `syncHolds` would notice later. But the caller reads
  // this result to decide whether to run the HOLDS_FAILED compensation, and it
  // charges the Trade_Fee to BOTH traders immediately after. So a single declined
  // card produced a cancelled trade with two 5% fees collected and no refund path —
  // against the caller's own "No exchange, no fee."
  //
  // The rows are written first, deliberately: the compensation voids the holds that
  // DID succeed, and it can only find them if they were recorded.
  if (anyHoldFailed) return { ok: false, error: 'hold-failed' };

  return { ok: true, bondsRequired: placements.length };
}

// ---------------------------------------------------------------------------
// Collateral side effects — HOLDS_FAILED cancellation (Req 5.6)
// ---------------------------------------------------------------------------

/** The repository subset the collateral cancellation hook needs. */
export type CollateralRepository = Pick<
  TradeProposalRepository,
  'getHolds' | 'markHoldStatus' | 'restoreItems' | 'listTradeItemIds'
>;

/**
 * Build a {@link RunSideEffects} hook for the collateral phase, wired into the
 * guarded transition core (`applyEvent`).
 *
 * On a HOLDS_FAILED event (a hold failed or the 300s confirmation window
 * elapsed) it cancels the Trade per Req 5.6: it requests a Hold_Void for every
 * still-active Pre_Auth_Hold on the Trade, marks those holds VOIDED, and
 * restores both paired Items' availability to AVAILABLE. All other events —
 * notably HOLDS_CONFIRMED, whose only effect is the COLLATERAL_PENDING ->
 * COLLATERAL_LOCKED transition performed by the core — need no payment side
 * effect and succeed as a no-op.
 *
 * Void operations always succeed in the provider contract, so this hook returns
 * `{ ok: true }` after cancellation; it only fails fast if no PaymentService was
 * injected into the orchestrator.
 */
export function createCollateralSideEffects(repository: CollateralRepository): RunSideEffects {
  return async (ctx) => {
    if (ctx.event !== 'HOLDS_FAILED') {
      return { ok: true };
    }

    if (!ctx.payments) {
      return { ok: false, detail: 'PaymentService is required to cancel collateral on HOLDS_FAILED' };
    }

    // Void every still-active hold at $0 (Req 5.6).
    const holds = await repository.getHolds(ctx.trade.id);
    for (const hold of holds) {
      if (hold.status === 'ACTIVE') {
        await ctx.payments.voidHold(hold.holdRef);
        await repository.markHoldStatus(hold.holdRef, 'VOIDED');
      }
    }

    // Restore every Item on the Trade, including extras on `trade_items`. The
    // two primary ids on the Trade row are a fallback for a 1:1 trade that
    // predates the bundle table.
    const bundledIds = await repository.listTradeItemIds(ctx.trade.id);
    const initiatorItemId = ctx.trade.initiator_item_id as string | undefined;
    const counterpartItemId = ctx.trade.counterpart_item_id as string | undefined;
    const fallbackIds = [initiatorItemId, counterpartItemId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const itemIds = bundledIds.length > 0 ? bundledIds : fallbackIds;
    if (itemIds.length > 0) {
      await repository.restoreItems(itemIds);
    }

    return { ok: true };
  };
}
