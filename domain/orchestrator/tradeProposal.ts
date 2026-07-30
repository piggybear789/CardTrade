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
//     the Bond Policy (`domain/bond/bondPolicy.ts`): a Trader with APPROVED
//     Managed Merchant identity (`merchant_status`) is exempt, everyone else
//     bonds against their own paired Item's FMV (revised Req 2.4, 5.4). Trading
//     itself (including cash terms) is never blocked by verification — only the
//     bond requirement changes.
//   * createCollateralSideEffects — a `RunSideEffects` hook for the guarded
//     transition core: on HOLDS_FAILED it cancels the Trade by voiding any
//     active holds and restoring both Items to AVAILABLE (Req 5.6). The
//     HOLDS_CONFIRMED -> COLLATERAL_LOCKED transition itself is performed by the
//     state-machine core (`applyEvent`) and needs no payment side effect.
//
// All monetary amounts are integer AUD cents.

import type { PaymentService, PreAuthHold } from '../services/types';
import { resolveTradeBonds, type BondPolicy } from '../bond/bondPolicy';
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
  /** Read all Pre_Auth_Holds for a Trade (used to void on cancellation). */
  getHolds(tradeId: string): Promise<RecordedHold[]>;
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
 * `0` (both Traders verified, so both bond-exempt) there is no provider event
 * coming to drive HOLDS_CONFIRMED, so the caller must dispatch that event itself
 * to move the Trade from COLLATERAL_PENDING to COLLATERAL_LOCKED.
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
  /**
   * When true (the default), a bond requirement on either Trader applies to both.
   * Set false for per-Trader bonds sized only by their own verification status.
   */
  symmetricBonds?: boolean;
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
function holdRef(tradeId: string, traderId: string): string {
  return `hold:${tradeId}:${traderId}`;
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
 * (Req 5.1), and requests a Pre_Auth_Hold sized at 100% of each Trader's own
 * paired Item FMV on that Trader's payment instrument (Req 5.4). The active /
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

  // What the Counterpart receives: the initiator's whole bundle.
  const initiatorSideCents = extraItems.reduce(
    (sum, entry) => sum + (entry?.fmvCents ?? 0),
    initiatorItem.fmvCents,
  );
  // What the initiator receives: the Counterpart's listed Item.
  const counterpartSideCents = counterpartItem.fmvCents;

  const { initiatorBondCents: proposerBond, counterpartBondCents: counterpartBond } =
    resolveTradeBonds({
      initiator: { verified: proposer.verified, fmvCents: counterpartSideCents },
      counterpart: { verified: counterpartProfile.verified, fmvCents: initiatorSideCents },
      policy: deps.bondPolicy,
      symmetric: deps.symmetricBonds,
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

  // Place a bond for each Trader who requires one, sized from that Trader's OWN
  // paired Item FMV. A verified Trader's bond is 0 and no hold is placed — their
  // verified identity is the guarantee instead.
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
    });
  }

  // With no bonds there is no provider event to drive HOLDS_CONFIRMED, so the
  // caller must dispatch it (see `ProposeTradeResult.bondsRequired`).
  return { ok: true, trade, bondsRequired: holdPlacements.length };
}

// ---------------------------------------------------------------------------
// Collateral side effects — HOLDS_FAILED cancellation (Req 5.6)
// ---------------------------------------------------------------------------

/** The repository subset the collateral cancellation hook needs. */
export type CollateralRepository = Pick<
  TradeProposalRepository,
  'getHolds' | 'markHoldStatus' | 'restoreItems'
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

    // Restore both paired Items to AVAILABLE (Req 5.6). The paired item ids ride
    // on the loaded Trade row via the TradeRecord index signature.
    const initiatorItemId = ctx.trade.initiator_item_id as string | undefined;
    const counterpartItemId = ctx.trade.counterpart_item_id as string | undefined;
    const itemIds = [initiatorItemId, counterpartItemId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (itemIds.length > 0) {
      await repository.restoreItems(itemIds);
    }

    return { ok: true };
  };
}
