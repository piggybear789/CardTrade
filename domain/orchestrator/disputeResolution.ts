// domain/orchestrator/disputeResolution.ts
//
// Trade disputes: raising a claim, the custody backstop, and the staff decision
// (design §1.2; ESC-01, ESC-07, ESC-10, ESC-23 ordering).
//
// NOTHING IS CAPTURED WHEN A PROBLEM IS RAISED. The previous version partially
// captured $20 from the accused the moment a condition dispute was raised, and a
// PaymentIntent can be captured only once: Stripe released the rest of the hold with
// that first capture, so a later fraud finding had nothing left to take. A dispute
// destroyed the collateral it existed to protect. Now:
//
//   * `raiseConditionDispute` / `raiseFraudClaim` freeze the trade and record who
//     said what. No money moves.
//   * `custodyCaptureHold` full-captures a live hold INTO THE PLATFORM BALANCE when
//     it is about to lapse with the case still open (the backstop sweep), so a slow
//     decision cannot destroy the remedy either.
//   * `resolveTradeDispute` is the staff decision, with four outcomes, in the order
//     validate -> locate live holds -> move money -> commit. The old fraud path
//     committed FRAUD_RESOLVED before it checked the victim was even a participant
//     (ESC-23); a refused decision now touches nothing.
//
// Money paid OUT of a captured hold is never paid inline. It is queued in
// `collateral_disbursements` and released by the hourly drain through
// `releasePolicy`, so a "victim" who is the fraudster's second account cannot cash
// out before anyone looks twice.
//
// Pure: the trade orchestrator, repository, payment service, cash-leg port, fee
// refund and notifier are all injected. The Supabase binding is
// `supabaseDisputeResolutionRepository.ts`. Nothing here logs; failures come back
// as typed results for the lib caller to report.
//
// All amounts are integer minor units of the trade's currency.

import type { Cents, PaymentService } from '../services/types';
import { frictionTaxPlatformFeeFor } from '../dispute/frictionTax';
import { currentHold, currentLiveHold } from '../bond/currentHolds';
import type { TradeCashLegPort, TradeDisputeOutcomeKind } from './tradeCashLeg';
import type { OrchestratorError, TradeOrchestrator, TradeRecord } from './tradeOrchestrator';

// The Friction_Tax amounts and the old return window are re-exported for existing
// importers. Nothing in this module reads the fixed amounts any more: the platform
// share is per currency (`frictionTaxPlatformFeeFor`) and the compensation is staff's.
export {
  FRICTION_TAX_CENTS,
  FRICTION_TAX_RETURN_SHIPPING_CENTS,
  FRICTION_TAX_PLATFORM_FEE_CENTS,
} from '../dispute/frictionTax';
export { DISPUTE_RETURN_WINDOW_DAYS } from '../dispute/returnWindow';

/**
 * Full-capture attempts before the trade is left DISPUTED for an operator.
 *
 * Every attempt sends the same idempotency key (`capture:full:<holdId>`), so this
 * recovers a transport failure, not a definite rejection. Do not vary the key: that
 * trades an operator task for the possibility of capturing a trader twice.
 */
export const MAX_FULL_CAPTURE_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Data-access seam
// ---------------------------------------------------------------------------

/** A Pre_Auth_Hold as read for dispute handling. */
export interface DisputeHold {
  traderId: string;
  holdRef: string;
  amountCents: Cents;
  capturedCents: Cents;
  status: 'ACTIVE' | 'VOIDED' | 'PARTIALLY_CAPTURED' | 'FULLY_CAPTURED' | 'FAILED' | 'EXPIRED';
  /** Insertion instant; orders a trader's attempts (ESC-07). */
  createdAt?: string | null;
  /** Set when the hold was captured into custody (the backstop, or a resolution). */
  custodyCapturedAt?: string | null;
}

/** One money movement to queue out of a captured hold. */
export interface NewCollateralDisbursement {
  tradeId: string;
  holdRef: string;
  kind: 'REFUND' | 'PAYOUT' | 'PLATFORM_RETAINED';
  payeeId: string | null;
  amountMinor: Cents;
  currency: string;
  /** Deterministic, so a retried resolution queues nothing twice. */
  nonce: string;
  /** A hold reason set at queue time (the `acknowledgeNoCollateral` placeholder). */
  holdReason?: 'STAFF' | null;
}

/**
 * Data access for dispute handling. Every write goes through the trusted
 * service-role path; the Supabase binding checks each returned `{ error }`.
 */
export interface DisputeResolutionRepository {
  loadTrade(tradeId: string): Promise<TradeRecord | null>;
  /** Every hold on the trade, oldest first. */
  getHolds(tradeId: string): Promise<DisputeHold[]>;
  /**
   * Whether the trade EVER reached INSPECTION (R4-M1): `inspection_deadline_at` is set,
   * or an audit row moved it into INSPECTION. Either alone proves a handover was
   * confirmed or assumed, so an audit row lost to a failed insert cannot reopen
   * NO_EXCHANGE. Throws on a read error; the caller refuses rather than guessing.
   */
  hasReachedInspection(tradeId: string): Promise<boolean>;
  /** SETTLED + queued disbursements already drawn from a hold, by status. */
  disbursedFromHold(holdRef: string): Promise<{ settledCents: Cents; queuedCents: Cents }>;

  /** Record the raising trader, the accused, and the raiser's own words (0083). */
  recordDisputeParticipants(params: {
    tradeId: string;
    raisedBy: string;
    disputedAgainst: string;
    at: Date;
    reason?: string | null;
  }): Promise<void>;
  /** Record a member's fraud CLAIM (0046 columns). First claim wins. */
  recordFraudClaim(params: { tradeId: string; claimantId: string; reason: string }): Promise<boolean>;

  /** Stamp a capture on a hold. A resolution capture is custody too: money held for members. */
  recordHoldCapture(params: {
    holdRef: string;
    capturedCents: Cents;
    status: 'PARTIALLY_CAPTURED' | 'FULLY_CAPTURED';
    custodyCapturedAt: Date;
  }): Promise<void>;
  markHoldVoided(holdRef: string): Promise<void>;
  /** Queue disbursements, ignoring any whose nonce is already queued. */
  queueDisbursements(rows: NewCollateralDisbursement[]): Promise<void>;
  /** Self-loop audit row `COLLATERAL_TAKEN_INTO_CUSTODY` (DISPUTED -> DISPUTED). */
  insertCustodyAudit(params: { tradeId: string; actorId: string | null; at: Date }): Promise<void>;

  /** Write the outcome and the attestation in ONE update. */
  recordOutcome(params: {
    tradeId: string;
    outcome: TradeDisputeOutcomeKind;
    attestedBy: string | null;
    at: Date;
    cancelled: boolean;
  }): Promise<void>;
  recordFraudParticipants(params: { tradeId: string; victimId: string; offendingId: string }): Promise<void>;
  incrementUnfoundedDisputeCount(profileId: string): Promise<void>;
  flagManualReconciliation(params: { tradeId: string; fullCaptureFailed?: boolean }): Promise<void>;
  /** The filtered restore (0133). Returns the ids put back on sale. */
  restoreTradeItemsIfUnclaimed(tradeId: string): Promise<string[]>;
}

/** Best-effort member notifications. Implementations must never throw. */
export interface DisputeNotifier {
  custodyCaptured(params: {
    tradeId: string;
    ownerId: string;
    otherId: string;
    amountCents: Cents;
    currency: string;
  }): Promise<void>;
  tradeUnwound(params: { tradeId: string; traderIds: string[]; cashRefunded: boolean }): Promise<void>;
  listingsRestored(params: { tradeId: string; itemIds: string[] }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dependencies + result types
// ---------------------------------------------------------------------------

/** Dependencies injected into the dispute coordinator. */
export interface DisputeResolutionDeps {
  orchestrator: TradeOrchestrator;
  repository: DisputeResolutionRepository;
  payments: PaymentService;
  /** What an outcome does to the cash leg (WP1: the legacy binding). */
  cashLeg?: TradeCashLegPort;
  /** Refund both Trade_Fees on NO_EXCHANGE (bound to `refundTradeFees`). */
  refundFees?: (tradeId: string) => Promise<{ ok: boolean; detail?: string }>;
  notifier?: DisputeNotifier;
  now?: () => Date;
  maxFullCaptureAttempts?: number;
}

/**
 * Typed failures.
 * - `NOT_PARTICIPANT`            the actor is not on the trade.
 * - `INVALID_OUTCOME`            the requested decision is not allowed here; nothing touched.
 * - `HOLD_NOT_FOUND`             the accused has no live hold; DISPUTED + manual flag.
 * - `CAPTURE_FAILED`             a capture failed; DISPUTED + manual flag.
 * - `HOLD_RELEASE_FAILED`        a void failed after money moved; DISPUTED + manual flag.
 * - `DISPUTE_HISTORY_UNAVAILABLE` the inspection history could not be read; nothing touched.
 * - `CUSTODY_CAPTURE_FAILED`     the backstop capture failed; flagged, retried next hour.
 */
export type DisputeResolutionError =
  | OrchestratorError
  | 'NOT_PARTICIPANT'
  | 'INVALID_OUTCOME'
  | 'HOLD_NOT_FOUND'
  | 'CAPTURE_FAILED'
  | 'HOLD_RELEASE_FAILED'
  | 'DISPUTE_HISTORY_UNAVAILABLE'
  | 'CUSTODY_CAPTURE_FAILED';

export type DisputeFailure = { ok: false; error: DisputeResolutionError; detail?: string };

/** The four staff outcomes (design §1.2). */
export type TradeDisputeOutcome =
  | { kind: 'UNFOUNDED'; goodsChangedHands?: boolean }
  | { kind: 'CONDITION'; wrongedTraderId: string; compensationMinor: Cents; goodsChangedHands?: boolean }
  | { kind: 'FRAUD'; victimId: string; acknowledgeNoCollateral?: boolean }
  | { kind: 'NO_EXCHANGE' };

/** What a resolution did. */
export interface TradeDisputeResolution {
  trade: TradeRecord;
  outcome: TradeDisputeOutcomeKind;
  /** The FRAUD offender (to ban), or the CONDITION accused. */
  offendingTraderId: string | null;
  disbursements: NewCollateralDisbursement[];
  voidedHoldRefs: string[];
  capturedHoldRefs: string[];
  manualReconciliation: boolean;
  /** NO_EXCHANGE only: the item ids put back on sale. */
  restoredItemIds: string[];
  /** NO_EXCHANGE only: whether refunding the Trade_Fees failed (the caller logs it). */
  feeRefundFailed: boolean;
}

export type ResolveTradeDisputeResult = { ok: true; resolution: TradeDisputeResolution } | DisputeFailure;

export type RaiseConditionDisputeResult =
  | { ok: true; trade: TradeRecord; disputedAgainst: string }
  | DisputeFailure;

export type RaiseFraudClaimResult =
  | { ok: true; trade: TradeRecord; accusedId: string; transitioned: boolean }
  | DisputeFailure;

export type CustodyCaptureReason = 'EXPIRY_BACKSTOP' | 'FRAUD_PROPOSAL';

export type CustodyCaptureResult =
  | { ok: true; alreadyCaptured: boolean; capturedCents: Cents }
  | DisputeFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function participants(trade: TradeRecord): [string, string] {
  return [String(trade.initiator_id ?? ''), String(trade.counterpart_id ?? '')];
}

/** The other trader, or null if `traderId` is not on the trade. */
function otherOf(trade: TradeRecord, traderId: string): string | null {
  const [a, b] = participants(trade);
  if (traderId === a) return b || null;
  if (traderId === b) return a || null;
  return null;
}

/** How a live hold is held, which decides what can still be done with it. */
export type HoldMode = 'ACTIVE' | 'CUSTODY' | 'LEGACY_PARTIAL';

function modeOf(hold: DisputeHold): HoldMode | null {
  if (hold.status === 'ACTIVE') return 'ACTIVE';
  if (hold.custodyCapturedAt && (hold.status === 'FULLY_CAPTURED' || hold.status === 'PARTIALLY_CAPTURED')) {
    return 'CUSTODY';
  }
  // Captured at RAISE by the pre-fix code. Stripe released the rest of the hold.
  if (hold.status === 'PARTIALLY_CAPTURED') return 'LEGACY_PARTIAL';
  return null;
}

/** The legacy $10 return share already paid out of a legacy partial capture. */
function legacyReturnPaid(trade: TradeRecord): Cents {
  return trade.friction_tax_return_paid_at ? Number(trade.friction_tax_return_cents ?? 0) : 0;
}

/**
 * `remainingFor(hold)`: what is still payable from a live hold (design §1.2 step 3).
 * - ACTIVE: the authorised amount.
 * - CUSTODY: captured minus disbursements that already SETTLED.
 * - LEGACY_PARTIAL: captured minus the legacy return share already paid, minus any
 *   disbursement already settled from it.
 */
async function remainingFor(
  deps: DisputeResolutionDeps,
  trade: TradeRecord,
  hold: DisputeHold,
): Promise<Cents> {
  const mode = modeOf(hold);
  if (mode === 'ACTIVE') return hold.amountCents;
  if (mode === null) return 0;
  const { settledCents } = await deps.repository.disbursedFromHold(hold.holdRef);
  return remainingFromFacts(hold, legacyReturnPaid(trade), settledCents);
}

/**
 * The pure core of `remainingFor`, exported so the arbitration console quotes the SAME
 * ceiling the resolution enforces (ESC-10) rather than restating the rule.
 */
export function remainingFromFacts(
  hold: DisputeHold,
  legacyReturnPaidCents: Cents,
  settledCents: Cents,
): Cents {
  const mode = modeOf(hold);
  if (mode === 'ACTIVE') return hold.amountCents;
  if (mode === null) return 0;
  const base = mode === 'LEGACY_PARTIAL' ? hold.capturedCents - legacyReturnPaidCents : hold.capturedCents;
  return Math.max(base - settledCents, 0);
}

/** How a hold stands behind a dispute: open, in custody, legacy partial, or not at all. */
export function disputeHoldMode(hold: DisputeHold): HoldMode | null {
  return modeOf(hold);
}

function nonceFor(tradeId: string, holdRef: string, kind: string, payee: string | null): string {
  return `collateral:${tradeId}:${holdRef}:${kind}:${payee ?? 'platform'}`;
}

function currencyOf(trade: TradeRecord): string {
  return String(trade.currency ?? 'aud').toLowerCase();
}

// ---------------------------------------------------------------------------
// Raising (no money moves)
// ---------------------------------------------------------------------------

/**
 * Raise a condition dispute during INSPECTION (Req 7.1). Records the raiser, the
 * accused (the other trader) and the raiser's account, and freezes the trade.
 * Captures NOTHING (ESC-01).
 */
export async function raiseConditionDispute(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string; reason?: string | null },
): Promise<RaiseConditionDisputeResult> {
  const now = deps.now ?? (() => new Date());
  const trade = await deps.repository.loadTrade(params.tradeId);
  if (!trade) return { ok: false, error: 'TRADE_NOT_FOUND' };
  const disputedAgainst = otherOf(trade, params.actorId);
  if (!disputedAgainst) return { ok: false, error: 'NOT_PARTICIPANT' };

  const transitioned = await deps.orchestrator.applyEvent({
    tradeId: params.tradeId,
    event: 'CONDITION_DISPUTE',
    actorId: params.actorId,
  });
  if (!transitioned.ok) return { ok: false, error: transitioned.error, detail: transitioned.detail };

  await deps.repository.recordDisputeParticipants({
    tradeId: params.tradeId,
    raisedBy: params.actorId,
    disputedAgainst,
    at: now(),
    reason: params.reason ?? null,
  });
  return { ok: true, trade: transitioned.trade, disputedAgainst };
}

/**
 * A member's fraud CLAIM (ESC-01, ESC-04). From COLLATERAL_LOCKED or INSPECTION it
 * applies `FRAUD_CLAIMED`; from DISPUTED it records the claim with no transition.
 * Captures nothing. Only staff decide fraud.
 */
export async function raiseFraudClaim(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string; reason: string },
): Promise<RaiseFraudClaimResult> {
  const now = deps.now ?? (() => new Date());
  const trade = await deps.repository.loadTrade(params.tradeId);
  if (!trade) return { ok: false, error: 'TRADE_NOT_FOUND' };
  const accusedId = otherOf(trade, params.actorId);
  if (!accusedId) return { ok: false, error: 'NOT_PARTICIPANT' };

  let current = trade;
  let transitioned = false;
  if (trade.state === 'COLLATERAL_LOCKED' || trade.state === 'INSPECTION') {
    const applied = await deps.orchestrator.applyEvent({
      tradeId: params.tradeId,
      event: 'FRAUD_CLAIMED',
      actorId: params.actorId,
    });
    if (!applied.ok) return { ok: false, error: applied.error, detail: applied.detail };
    current = applied.trade;
    transitioned = true;
    await deps.repository.recordDisputeParticipants({
      tradeId: params.tradeId,
      raisedBy: params.actorId,
      disputedAgainst: accusedId,
      at: now(),
      reason: params.reason,
    });
  } else if (trade.state !== 'DISPUTED') {
    return { ok: false, error: 'INVALID_TRANSITION' };
  }

  await deps.repository.recordFraudClaim({
    tradeId: params.tradeId,
    claimantId: params.actorId,
    reason: params.reason,
  });
  return { ok: true, trade: current, accusedId, transitioned };
}

// ---------------------------------------------------------------------------
// Custody (the backstop and a pending fraud finding)
// ---------------------------------------------------------------------------

/**
 * Full-capture a live hold INTO THE PLATFORM BALANCE while a dispute is open.
 *
 * DISPUTED only, and only a participant's current live ACTIVE hold. A hold already
 * in custody is an idempotent no-op, so the backstop and a fraud proposal racing on
 * one hold cannot capture twice. The audit row carries the neutral code
 * `COLLATERAL_TAKEN_INTO_CUSTODY` whatever the reason: the code is member-visible,
 * and a reason would tell the accused a fraud finding is pending.
 */
export async function custodyCaptureHold(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; holdRef: string; reason: CustodyCaptureReason; actorId?: string | null },
): Promise<CustodyCaptureResult> {
  const now = deps.now ?? (() => new Date());
  const trade = await deps.repository.loadTrade(params.tradeId);
  if (!trade) return { ok: false, error: 'TRADE_NOT_FOUND' };
  if (trade.state !== 'DISPUTED') {
    return { ok: false, error: 'INVALID_OUTCOME', detail: 'Only a disputed trade has collateral taken into custody.' };
  }

  const holds = await deps.repository.getHolds(params.tradeId);
  const hold = holds.find((h) => h.holdRef === params.holdRef);
  const owner = hold?.traderId ?? '';
  const other = otherOf(trade, owner);
  if (!hold || !other || currentLiveHold(holds, owner)?.holdRef !== params.holdRef) {
    return { ok: false, error: 'INVALID_OUTCOME', detail: 'That is not a trader’s current hold.' };
  }
  if (modeOf(hold) === 'CUSTODY') {
    return { ok: true, alreadyCaptured: true, capturedCents: hold.capturedCents };
  }
  if (hold.status !== 'ACTIVE') {
    return { ok: false, error: 'INVALID_OUTCOME', detail: 'That hold is no longer an open authorisation.' };
  }

  const capture = await deps.payments.fullCapture(hold.holdRef);
  if (capture.status !== 'SETTLED') {
    await deps.repository.flagManualReconciliation({ tradeId: params.tradeId });
    return { ok: false, error: 'CUSTODY_CAPTURE_FAILED', detail: params.reason };
  }

  const at = now();
  await deps.repository.recordHoldCapture({
    holdRef: hold.holdRef,
    capturedCents: capture.amount,
    status: 'FULLY_CAPTURED',
    custodyCapturedAt: at,
  });
  await deps.repository.insertCustodyAudit({ tradeId: params.tradeId, actorId: params.actorId ?? null, at });
  await deps.notifier?.custodyCaptured({
    tradeId: params.tradeId,
    ownerId: owner,
    otherId: other,
    amountCents: capture.amount,
    currency: currencyOf(trade),
  });
  return { ok: true, alreadyCaptured: false, capturedCents: capture.amount };
}

// ---------------------------------------------------------------------------
// The staff decision
// ---------------------------------------------------------------------------

interface MoneyPlan {
  /** ACTIVE holds to capture: amount, or 'FULL'. */
  captures: Array<{ hold: DisputeHold; amount: Cents | 'FULL' }>;
  /** ACTIVE holds to void. */
  voids: DisputeHold[];
  /** Disbursements whose amounts do not depend on a capture result. */
  disbursements: NewCollateralDisbursement[];
  /** FRAUD on an ACTIVE offender hold: pay the captured amount to the victim. */
  payCaptureTo?: { holdRef: string; payeeId: string };
  /** CONDITION on an ACTIVE accused hold: split the capture. */
  splitCapture?: { holdRef: string; wrongedId: string; compensation: Cents; platformShare: Cents };
}

/** Plan the release of one trader's own live hold (they are owed it back in full). */
async function releaseInFull(
  deps: DisputeResolutionDeps,
  trade: TradeRecord,
  hold: DisputeHold | undefined,
  plan: MoneyPlan,
): Promise<void> {
  if (!hold) return;
  const mode = modeOf(hold);
  if (mode === 'ACTIVE') {
    plan.voids.push(hold);
    return;
  }
  const remaining = await remainingFor(deps, trade, hold);
  if (remaining > 0) {
    plan.disbursements.push({
      tradeId: trade.id,
      holdRef: hold.holdRef,
      kind: 'REFUND',
      payeeId: hold.traderId,
      amountMinor: remaining,
      currency: currencyOf(trade),
      nonce: nonceFor(trade.id, hold.holdRef, 'REFUND', hold.traderId),
    });
  }
}

/**
 * Resolve a DISPUTED trade with a staff-chosen outcome (design §1.2, steps 1–6).
 *
 * Order: validate -> locate live holds -> move money -> commit. A refusal at any
 * step before the money moves touches nothing; a money failure leaves the trade
 * DISPUTED with `manual_reconciliation`, never terminal over a live hold (ESC-07).
 */
export async function resolveTradeDispute(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string; outcome: TradeDisputeOutcome },
): Promise<ResolveTradeDisputeResult> {
  const { repository, payments } = deps;
  const now = deps.now ?? (() => new Date());
  const maxAttempts = deps.maxFullCaptureAttempts ?? MAX_FULL_CAPTURE_ATTEMPTS;
  const { outcome } = params;

  // ---- 1. Validate -------------------------------------------------------
  const trade = await repository.loadTrade(params.tradeId);
  if (!trade) return { ok: false, error: 'TRADE_NOT_FOUND' };
  if (trade.state !== 'DISPUTED') {
    return { ok: false, error: 'INVALID_OUTCOME', detail: 'Only a disputed trade can be resolved.' };
  }
  const [initiatorId, counterpartId] = participants(trade);

  let accusedId: string | null = null;
  if (outcome.kind === 'CONDITION') {
    accusedId = otherOf(trade, outcome.wrongedTraderId);
    if (!accusedId) return { ok: false, error: 'INVALID_OUTCOME', detail: 'The wronged trader is not on this trade.' };
    if (!Number.isInteger(outcome.compensationMinor) || outcome.compensationMinor < 0) {
      return { ok: false, error: 'INVALID_OUTCOME', detail: 'Compensation must be a whole amount of at least 0.' };
    }
  }
  if (outcome.kind === 'FRAUD') {
    accusedId = otherOf(trade, outcome.victimId);
    if (!accusedId) return { ok: false, error: 'INVALID_OUTCOME', detail: 'The victim is not on this trade.' };
  }

  let inspected: boolean;
  try {
    inspected = await repository.hasReachedInspection(params.tradeId);
  } catch (error) {
    return {
      ok: false,
      error: 'DISPUTE_HISTORY_UNAVAILABLE',
      detail: error instanceof Error ? error.message : undefined,
    };
  }

  if (outcome.kind === 'NO_EXCHANGE' && inspected) {
    return {
      ok: false,
      error: 'INVALID_OUTCOME',
      detail: 'Both traders confirmed or passed the handover, so the trade cannot be undone.',
    };
  }
  const attests = (outcome.kind === 'UNFOUNDED' || outcome.kind === 'CONDITION') && !inspected;
  if (attests && outcome.goodsChangedHands !== true) {
    return {
      ok: false,
      error: 'INVALID_OUTCOME',
      detail:
        "Nothing shows the cards changed hands. Choose 'The exchange didn't happen', or confirm the goods did change hands.",
    };
  }

  // ---- 2. Locate live holds ---------------------------------------------
  const holds = await repository.getHolds(params.tradeId);
  const liveOf = (traderId: string) => currentLiveHold(holds, traderId);
  const currency = currencyOf(trade);
  const plan: MoneyPlan = { captures: [], voids: [], disbursements: [] };

  if (outcome.kind === 'UNFOUNDED' || outcome.kind === 'NO_EXCHANGE') {
    await releaseInFull(deps, trade, liveOf(initiatorId), plan);
    await releaseInFull(deps, trade, liveOf(counterpartId), plan);
  }

  if (outcome.kind === 'CONDITION' && accusedId) {
    const accusedHold = liveOf(accusedId);
    if (!accusedHold) {
      await repository.flagManualReconciliation({ tradeId: params.tradeId });
      return { ok: false, error: 'HOLD_NOT_FOUND', detail: accusedId };
    }
    const mode = modeOf(accusedHold)!;
    const remaining = await remainingFor(deps, trade, accusedHold);
    const X = outcome.compensationMinor;
    let platformShare: Cents;
    if (mode === 'LEGACY_PARTIAL') {
      // The platform share was already captured at raise by the pre-fix code.
      platformShare = Math.min(Number(trade.friction_tax_platform_cents ?? 0), remaining);
      if (X > remaining - platformShare) {
        return { ok: false, error: 'INVALID_OUTCOME', detail: `Compensation can be at most ${remaining - platformShare}.` };
      }
    } else {
      if (X > remaining) {
        return { ok: false, error: 'INVALID_OUTCOME', detail: `Compensation can be at most ${remaining}.` };
      }
      platformShare = Math.min(frictionTaxPlatformFeeFor(currency), remaining - X);
    }

    if (mode === 'ACTIVE') {
      if (X + platformShare === 0) {
        // Stripe refuses a zero capture; nothing is owed, so release the hold.
        plan.voids.push(accusedHold);
      } else {
        plan.captures.push({ hold: accusedHold, amount: X + platformShare });
        plan.splitCapture = { holdRef: accusedHold.holdRef, wrongedId: outcome.wrongedTraderId, compensation: X, platformShare };
      }
    } else {
      const refundRest = remaining - X - platformShare;
      if (X > 0) {
        plan.disbursements.push({
          tradeId: trade.id, holdRef: accusedHold.holdRef, kind: 'PAYOUT', payeeId: outcome.wrongedTraderId,
          amountMinor: X, currency, nonce: nonceFor(trade.id, accusedHold.holdRef, 'PAYOUT', outcome.wrongedTraderId),
        });
      }
      // A legacy hold's platform share is already the platform's (it was captured as
      // such), so only a custody hold queues it explicitly.
      if (mode === 'CUSTODY' && platformShare > 0) {
        plan.disbursements.push({
          tradeId: trade.id, holdRef: accusedHold.holdRef, kind: 'PLATFORM_RETAINED', payeeId: null,
          amountMinor: platformShare, currency, nonce: nonceFor(trade.id, accusedHold.holdRef, 'PLATFORM_RETAINED', null),
        });
      }
      if (refundRest > 0) {
        plan.disbursements.push({
          tradeId: trade.id, holdRef: accusedHold.holdRef, kind: 'REFUND', payeeId: accusedId,
          amountMinor: refundRest, currency, nonce: nonceFor(trade.id, accusedHold.holdRef, 'REFUND', accusedId),
        });
      }
    }
    await releaseInFull(deps, trade, liveOf(outcome.wrongedTraderId), plan);
  }

  let acknowledgedNoCollateral = false;
  if (outcome.kind === 'FRAUD' && accusedId) {
    const offenderHolds = holds.filter((h) => h.traderId === accusedId);
    const offenderBacked = offenderHolds.some((h) => {
      const mode = modeOf(h);
      return mode === 'ACTIVE' || mode === 'CUSTODY';
    });
    const offenderLive = liveOf(accusedId);

    if (outcome.acknowledgeNoCollateral) {
      // Accepted only when there is genuinely nothing capturable left (2a).
      if (offenderBacked) {
        return {
          ok: false,
          error: 'INVALID_OUTCOME',
          detail: 'The offender still has live collateral, so there is no need to override.',
        };
      }
      acknowledgedNoCollateral = true;
      const legacyRemaining =
        offenderLive && modeOf(offenderLive) === 'LEGACY_PARTIAL' ? await remainingFor(deps, trade, offenderLive) : 0;
      if (offenderLive && legacyRemaining > 0) {
        plan.disbursements.push({
          tradeId: trade.id, holdRef: offenderLive.holdRef, kind: 'PAYOUT', payeeId: outcome.victimId,
          amountMinor: legacyRemaining, currency,
          nonce: nonceFor(trade.id, offenderLive.holdRef, 'PAYOUT', outcome.victimId),
        });
      } else {
        // The placeholder for any platform-funded goodwill staff decide later.
        const ref = currentHold(holds, accusedId)?.holdRef ?? `none:${trade.id}`;
        plan.disbursements.push({
          tradeId: trade.id, holdRef: ref, kind: 'PAYOUT', payeeId: outcome.victimId, amountMinor: 0, currency,
          nonce: nonceFor(trade.id, ref, 'PAYOUT', outcome.victimId), holdReason: 'STAFF',
        });
      }
    } else {
      if (!offenderLive) {
        await repository.flagManualReconciliation({ tradeId: params.tradeId });
        return { ok: false, error: 'HOLD_NOT_FOUND', detail: accusedId };
      }
      const mode = modeOf(offenderLive)!;
      if (mode === 'ACTIVE') {
        plan.captures.push({ hold: offenderLive, amount: 'FULL' });
        plan.payCaptureTo = { holdRef: offenderLive.holdRef, payeeId: outcome.victimId };
      } else {
        // Custody or legacy: pay what is left to the victim. On a legacy hold the
        // platform waives its share on a fraud finding.
        const remaining = await remainingFor(deps, trade, offenderLive);
        if (remaining > 0) {
          plan.disbursements.push({
            tradeId: trade.id, holdRef: offenderLive.holdRef, kind: 'PAYOUT', payeeId: outcome.victimId,
            amountMinor: remaining, currency, nonce: nonceFor(trade.id, offenderLive.holdRef, 'PAYOUT', outcome.victimId),
          });
        }
      }
    }
    await releaseInFull(deps, trade, liveOf(outcome.victimId), plan);
  }

  // Any other still-ACTIVE row (a stray earlier attempt) is released too, so the trade
  // never ends over an open authorisation. Terminal rows are skipped (ESC-10 noise).
  const planned = new Set([...plan.captures.map((c) => c.hold.holdRef), ...plan.voids.map((h) => h.holdRef)]);
  for (const hold of holds) {
    if (hold.status === 'ACTIVE' && !planned.has(hold.holdRef)) plan.voids.push(hold);
  }

  // ---- 3. Move money ----------------------------------------------------
  const capturedHoldRefs: string[] = [];
  const disbursements = [...plan.disbursements];
  for (const { hold, amount } of plan.captures) {
    let settledAmount: Cents | null = null;
    if (amount === 'FULL') {
      for (let attempt = 0; attempt < maxAttempts && settledAmount === null; attempt += 1) {
        const capture = await payments.fullCapture(hold.holdRef);
        if (capture.status === 'SETTLED') settledAmount = capture.amount;
      }
    } else {
      const capture = await payments.partialCapture({ holdId: hold.holdRef, amount });
      if (capture.status === 'SETTLED') settledAmount = capture.amount;
    }
    if (settledAmount === null) {
      await repository.flagManualReconciliation({ tradeId: params.tradeId, fullCaptureFailed: amount === 'FULL' });
      return { ok: false, error: 'CAPTURE_FAILED', detail: hold.holdRef };
    }
    // Stamped as custody: the money is held for members until its disbursements
    // settle, and a retried resolution then reads it as captured, not as an open hold.
    await repository.recordHoldCapture({
      holdRef: hold.holdRef,
      capturedCents: settledAmount,
      status: amount === 'FULL' ? 'FULLY_CAPTURED' : 'PARTIALLY_CAPTURED',
      custodyCapturedAt: now(),
    });
    capturedHoldRefs.push(hold.holdRef);

    if (plan.payCaptureTo?.holdRef === hold.holdRef && settledAmount > 0) {
      disbursements.push({
        tradeId: trade.id, holdRef: hold.holdRef, kind: 'PAYOUT', payeeId: plan.payCaptureTo.payeeId,
        amountMinor: settledAmount, currency, nonce: nonceFor(trade.id, hold.holdRef, 'PAYOUT', plan.payCaptureTo.payeeId),
      });
    }
    if (plan.splitCapture?.holdRef === hold.holdRef) {
      const { wrongedId, compensation, platformShare } = plan.splitCapture;
      // Never more than the provider actually took: compensation first, then the
      // platform's share.
      const paid = Math.min(compensation, settledAmount);
      const kept = Math.min(platformShare, settledAmount - paid);
      if (paid > 0) {
        disbursements.push({
          tradeId: trade.id, holdRef: hold.holdRef, kind: 'PAYOUT', payeeId: wrongedId, amountMinor: paid, currency,
          nonce: nonceFor(trade.id, hold.holdRef, 'PAYOUT', wrongedId),
        });
      }
      if (kept > 0) {
        disbursements.push({
          tradeId: trade.id, holdRef: hold.holdRef, kind: 'PLATFORM_RETAINED', payeeId: null, amountMinor: kept, currency,
          nonce: nonceFor(trade.id, hold.holdRef, 'PLATFORM_RETAINED', null),
        });
      }
    }
  }

  const voidedHoldRefs: string[] = [];
  for (const hold of plan.voids) {
    const released = await payments.voidHold(hold.holdRef);
    if (released.status !== 'VOIDED') {
      // Left ACTIVE so `expire_lapsed_holds` still owns it; the trade stays DISPUTED.
      await repository.flagManualReconciliation({ tradeId: params.tradeId });
      return { ok: false, error: 'HOLD_RELEASE_FAILED', detail: hold.holdRef };
    }
    await repository.markHoldVoided(hold.holdRef);
    voidedHoldRefs.push(hold.holdRef);
  }

  if (disbursements.length > 0) await repository.queueDisbursements(disbursements);

  // ---- 4. Commit --------------------------------------------------------
  const event =
    outcome.kind === 'NO_EXCHANGE' ? 'DISPUTE_UNWOUND' : outcome.kind === 'FRAUD' ? 'FRAUD_CONFIRMED' : 'DISPUTE_RESOLVED';
  const committed = await deps.orchestrator.applyEvent({ tradeId: params.tradeId, event, actorId: params.actorId });
  if (!committed.ok) return { ok: false, error: committed.error, detail: committed.detail };

  const at = now();
  await repository.recordOutcome({
    tradeId: params.tradeId,
    outcome: outcome.kind,
    attestedBy: attests ? params.actorId : null,
    at,
    cancelled: outcome.kind === 'NO_EXCHANGE',
  });

  let manualReconciliation = false;
  if (outcome.kind === 'FRAUD' && accusedId) {
    await repository.recordFraudParticipants({ tradeId: params.tradeId, victimId: outcome.victimId, offendingId: accusedId });
    if (acknowledgedNoCollateral) {
      manualReconciliation = true;
      await repository.flagManualReconciliation({ tradeId: params.tradeId, fullCaptureFailed: true });
    }
  }
  if (outcome.kind === 'UNFOUNDED' && trade.dispute_raised_by) {
    await repository.incrementUnfoundedDisputeCount(String(trade.dispute_raised_by));
  }

  // ---- 5. The cash leg ---------------------------------------------------
  const hasCash = Number(trade.cash_amount_cents ?? 0) > 0;
  if (hasCash && deps.cashLeg) {
    const cash = await deps.cashLeg.settleForOutcome(
      params.tradeId,
      outcome.kind,
      // ESC-06: on FRAUD the collected cash goes to whichever side was wronged.
      outcome.kind === 'FRAUD' ? { victimId: outcome.victimId } : undefined,
    );
    if (cash.manualReconciliation) {
      manualReconciliation = true;
      await repository.flagManualReconciliation({ tradeId: params.tradeId });
    }
  }

  // ---- 6. NO_EXCHANGE: restore what nothing else claims, refund the fees ----
  let restoredItemIds: string[] = [];
  let feeRefundFailed = false;
  if (outcome.kind === 'NO_EXCHANGE') {
    restoredItemIds = await repository.restoreTradeItemsIfUnclaimed(params.tradeId);
    if (deps.refundFees) {
      const refunded = await deps.refundFees(params.tradeId);
      feeRefundFailed = !refunded.ok;
    }
    if (restoredItemIds.length > 0) {
      await deps.notifier?.listingsRestored({ tradeId: params.tradeId, itemIds: restoredItemIds });
    }
    await deps.notifier?.tradeUnwound({
      tradeId: params.tradeId,
      traderIds: [initiatorId, counterpartId],
      // The legacy cash leg was never collected, so nothing is refunded in WP1.
      cashRefunded: false,
    });
  }

  return {
    ok: true,
    resolution: {
      trade: committed.trade,
      outcome: outcome.kind,
      offendingTraderId: accusedId,
      disbursements,
      voidedHoldRefs,
      capturedHoldRefs,
      manualReconciliation,
      restoredItemIds,
      feeRefundFailed,
    },
  };
}

// ---------------------------------------------------------------------------
// Bound coordinator
// ---------------------------------------------------------------------------

/** The dispute coordinator with its dependencies pre-wired. */
export interface DisputeResolutionOrchestrator {
  raiseConditionDispute(params: { tradeId: string; actorId: string; reason?: string | null }): Promise<RaiseConditionDisputeResult>;
  raiseFraudClaim(params: { tradeId: string; actorId: string; reason: string }): Promise<RaiseFraudClaimResult>;
  resolveTradeDispute(params: { tradeId: string; actorId: string; outcome: TradeDisputeOutcome }): Promise<ResolveTradeDisputeResult>;
  custodyCaptureHold(params: {
    tradeId: string;
    holdRef: string;
    reason: CustodyCaptureReason;
    actorId?: string | null;
  }): Promise<CustodyCaptureResult>;
}

/** Bind the dispute operations to a set of dependencies. */
export function createDisputeResolutionOrchestrator(deps: DisputeResolutionDeps): DisputeResolutionOrchestrator {
  return {
    raiseConditionDispute: (params) => raiseConditionDispute(deps, params),
    raiseFraudClaim: (params) => raiseFraudClaim(deps, params),
    resolveTradeDispute: (params) => resolveTradeDispute(deps, params),
    custodyCaptureHold: (params) => custodyCaptureHold(deps, params),
  };
}
