// domain/orchestrator/collateralReconcile.ts
//
// ONE rule for "is this trade's collateral complete, so it may lock" (ESC-08).
//
// WHY THIS EXISTS. `hold.active` used to map straight to the trade event
// HOLDS_CONFIRMED, so the FIRST trader's authorisation webhook locked the whole trade
// while the other trader's hold was still pending, declined, or never placed. The
// synchronous paths had the same hole in other forms: the "process died" path
// confirmed without fees, and each site sent its own "collateral locked" notification.
//
// Now a provider hold event is only a statement about ONE hold row:
//
//   * `reconcileHoldStatus` writes it onto that row, and ONLY when it is the trader's
//     CURRENT attempt. A late event for a superseded attempt (a declined first try, a
//     voided earlier hold) is a NO_OP rather than overwriting the live row.
//   * `confirmCollateralIfComplete` locks the trade only when EVERY trader's current
//     hold is ACTIVE (`currentHoldsCoverTraders`) and the injected cash-leg and fee
//     predicates pass (both `() => true` until WP2 / WP3 make them real). It notifies
//     both traders exactly once, and only when its own guarded transition moved the
//     row from COLLATERAL_PENDING to COLLATERAL_LOCKED.
//
// Every site that used to dispatch HOLDS_CONFIRMED calls `confirmCollateralIfComplete`
// instead: the webhook, the synchronous sync, the process-died path, and the retry.
//
// Pure: no Supabase, React or service imports. Data access and notifications are
// injected.

import type { TradeEvent } from '../state-machine/types';
import { currentHold, currentHoldsCoverTraders, type HoldLike } from '../bond/currentHolds';
import type { ApplyEventResult, TradeRecord } from './tradeOrchestrator';

/** The data the rule reads and the one write it makes. */
export interface CollateralReconcileRepository {
  /** Every hold on the trade, oldest first. */
  getHolds(tradeId: string): Promise<HoldLike[]>;
  markHoldStatus(holdRef: string, status: HoldLike['status']): Promise<void>;
}

export interface CollateralReconcileDeps {
  repository: CollateralReconcileRepository;
  /** The guarded transition core (optimistic, state-checked). */
  applyEvent(params: { tradeId: string; event: TradeEvent; actorId: string }): Promise<ApplyEventResult>;
  loadTrade(tradeId: string): Promise<Pick<TradeRecord, 'id' | 'state' | 'initiator_id' | 'counterpart_id'> | null>;
  /** Sent only when THIS call locked the trade. Must never throw. */
  notifyLocked(params: { tradeId: string; initiatorId: string; counterpartId: string }): Promise<void>;
  /** WP2 (ESC-05): the cash leg is collected. Defaults to true. */
  isCashLegCollected?: (tradeId: string) => Promise<boolean>;
  /** WP3 (ESC-29): both Trade_Fees settled. Defaults to true. */
  areFeesSettled?: (tradeId: string) => Promise<boolean>;
}

export type ConfirmCollateralResult =
  | { kind: 'LOCKED' }
  | { kind: 'ALREADY_LOCKED' }
  | { kind: 'NOT_PENDING'; state: string }
  | { kind: 'INCOMPLETE'; reason: 'HOLDS' | 'CASH' | 'FEES' }
  | { kind: 'FAILED'; error: string; detail?: string };

export type ReconcileHoldResult =
  | { kind: 'NO_OP'; reason: 'UNKNOWN_HOLD' | 'STALE_HOLD' }
  | { kind: 'RECORDED'; status: 'ACTIVE' | 'FAILED'; confirm?: ConfirmCollateralResult; failed?: ApplyEventResult };

/**
 * Lock the trade if, and only if, its collateral is complete.
 *
 * `noBondsRequired` is the zero-bond case (nobody owes a hold, so no row will ever be
 * ACTIVE). `tradeSidesAreValued` refuses a zero side upstream, so this is a
 * near-unreachable path kept for the bond policy's exemption, never a default.
 */
export async function confirmCollateralIfComplete(
  deps: CollateralReconcileDeps,
  params: { tradeId: string; actorId: string; noBondsRequired?: boolean },
): Promise<ConfirmCollateralResult> {
  const trade = await deps.loadTrade(params.tradeId);
  if (!trade) return { kind: 'FAILED', error: 'TRADE_NOT_FOUND' };
  if (trade.state === 'COLLATERAL_LOCKED') return { kind: 'ALREADY_LOCKED' };
  if (trade.state !== 'COLLATERAL_PENDING') return { kind: 'NOT_PENDING', state: String(trade.state) };

  if (!params.noBondsRequired) {
    const holds = await deps.repository.getHolds(params.tradeId);
    if (!currentHoldsCoverTraders(holds, [trade.initiator_id as string, trade.counterpart_id as string])) {
      return { kind: 'INCOMPLETE', reason: 'HOLDS' };
    }
  }
  if (deps.isCashLegCollected && !(await deps.isCashLegCollected(params.tradeId))) {
    return { kind: 'INCOMPLETE', reason: 'CASH' };
  }
  if (deps.areFeesSettled && !(await deps.areFeesSettled(params.tradeId))) {
    return { kind: 'INCOMPLETE', reason: 'FEES' };
  }

  const result = await deps.applyEvent({ tradeId: params.tradeId, event: 'HOLDS_CONFIRMED', actorId: params.actorId });
  if (!result.ok) {
    // Another path locked it between our read and our write: not ours to announce.
    const again = await deps.loadTrade(params.tradeId);
    if (again?.state === 'COLLATERAL_LOCKED') return { kind: 'ALREADY_LOCKED' };
    return { kind: 'FAILED', error: result.error, detail: result.detail };
  }
  if (result.trade.state !== 'COLLATERAL_LOCKED') {
    return { kind: 'NOT_PENDING', state: String(result.trade.state) };
  }
  await deps.notifyLocked({
    tradeId: params.tradeId,
    initiatorId: trade.initiator_id as string,
    counterpartId: trade.counterpart_id as string,
  });
  return { kind: 'LOCKED' };
}

/**
 * Apply a provider statement about ONE hold.
 *
 * Writes only when `holdId` is that trader's current attempt; then an ACTIVE hold
 * tries to lock the trade and a FAILED one runs HOLDS_FAILED (which loops the trade
 * back to COLLATERAL_PENDING and runs the compensation side effects).
 */
export async function reconcileHoldStatus(
  deps: CollateralReconcileDeps,
  params: { tradeId: string; holdId: string; status: 'ACTIVE' | 'FAILED'; actorId: string },
): Promise<ReconcileHoldResult> {
  const holds = await deps.repository.getHolds(params.tradeId);
  const row = holds.find((hold) => hold.holdRef === params.holdId);
  if (!row) return { kind: 'NO_OP', reason: 'UNKNOWN_HOLD' };
  if (currentHold(holds, row.traderId)?.holdRef !== params.holdId) {
    return { kind: 'NO_OP', reason: 'STALE_HOLD' };
  }

  if (row.status !== params.status) {
    await deps.repository.markHoldStatus(params.holdId, params.status);
  }

  if (params.status === 'ACTIVE') {
    const confirm = await confirmCollateralIfComplete(deps, { tradeId: params.tradeId, actorId: params.actorId });
    return { kind: 'RECORDED', status: 'ACTIVE', confirm };
  }
  const failed = await deps.applyEvent({ tradeId: params.tradeId, event: 'HOLDS_FAILED', actorId: params.actorId });
  return { kind: 'RECORDED', status: 'FAILED', failed };
}
