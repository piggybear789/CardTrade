// domain/orchestrator/disputeResolution.ts
//
// Condition-dispute (Req 7) and objective-fraud (Req 8) resolution for the
// 2-Way Trade escrow.
//
// Like the other orchestration modules, this is a pure/injectable coordination
// layer: it depends only on *interfaces* — a bound `TradeOrchestrator` (for the
// guarded state-machine transition), a `DisputeResolutionRepository` (for the
// dispute/fraud-specific reads/writes) and the `PaymentService` (captures/voids/
// transfers). The concrete Supabase admin binding lives in
// `supabaseDisputeResolutionRepository.ts`, which is the only file that pulls in
// `server-only`.
//
// This module deliberately takes NO KYC dependency. It previously read verified
// identity data to build a "Police_Evidence_Pack" PDF; that has been removed
// (see the note in `resolveObjectiveFraud`), so identity verification is now
// pass/fail only and no verified identity field is ever read.
//
// Why a coordinator (functions) rather than a pre-commit `RunSideEffects` hook:
// neither a Condition_Dispute nor an Objective_Fraud is *gated* by its payment
// outcome — the Trade transitions to DISPUTED / FRAUD_RESOLVED regardless (Req
// 7.1, 8.1), and a Friction_Tax or Full_Capture failure is recorded as an
// *indication* without rolling the state back (Req 7.6, 8.6). So the transition
// is committed first via `TradeOrchestrator.applyEvent`, then the post-transition
// side effects run against the freshly committed Trade.
//
// All monetary amounts are integer AUD cents.

import type { Cents, PaymentService, PreAuthHold } from '../services/types';
import {
  FRICTION_TAX_CENTS,
  FRICTION_TAX_PLATFORM_FEE_CENTS,
  FRICTION_TAX_RETURN_SHIPPING_CENTS,
} from '../dispute/frictionTax';
import { canReceiveFunds, type MerchantRecord } from './merchantOnboarding';
import type { OrchestratorError, TradeOrchestrator, TradeRecord } from './tradeOrchestrator';

// ---------------------------------------------------------------------------
// Constants (Req 7.2, 7.3, 8.6)
// ---------------------------------------------------------------------------

// The Friction_Tax amounts now live in `domain/dispute/frictionTax.ts` and are
// re-exported here so existing importers are unaffected. They were declared
// independently in three modules; see that file for why one source matters.
export {
  FRICTION_TAX_CENTS,
  FRICTION_TAX_RETURN_SHIPPING_CENTS,
  FRICTION_TAX_PLATFORM_FEE_CENTS,
} from '../dispute/frictionTax';

/** The return window for a disputed Item: 14 calendar days (Req 7.5, 7.7). */
export const DISPUTE_RETURN_WINDOW_DAYS = 14;

/**
 * The maximum number of Full_Capture attempts on Objective_Fraud before the
 * Trade is flagged for manual reconciliation (Req 8.6, "retry up to 3 times").
 * Overridable via {@link DisputeResolutionDeps.maxFullCaptureAttempts}.
 */
export const MAX_FULL_CAPTURE_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Data-access seam
// ---------------------------------------------------------------------------

/** A Pre_Auth_Hold as read for dispute/fraud handling. */
export interface DisputeHold {
  traderId: string;
  holdRef: string;
  amountCents: Cents;
  capturedCents: Cents;
  status: PreAuthHold['status'];
}

/** The Friction_Tax allocation recorded when the partial capture settles (Req 7.3). */
export interface FrictionTaxAllocation {
  returnShippingCents: Cents;
  platformFeeCents: Cents;
}

/**
 * Data-access seam for dispute/fraud resolution. Backed by the Supabase admin
 * client in production (`supabaseDisputeResolutionRepository.ts`) and by an
 * in-memory fake in tests. Every write goes through the trusted service-role
 * path because a valid resolution must mutate the Trade and its holds together.
 */
export interface DisputeResolutionRepository {
  /** Read all Pre_Auth_Holds for a Trade. */
  getHolds(tradeId: string): Promise<DisputeHold[]>;

  /**
   * Read a Trader's PAYOUT destination — their Connect state — used when paying
   * captured fraud collateral to the victim (Req 8.3). `null` when the Trader has
   * no merchant record at all.
   *
   * THIS REPLACED `getTraderPayerId`, AND THE DIFFERENCE IS THE WHOLE BUG. A payer
   * reference is a saved CARD: it is where money is collected FROM. Paying a victim
   * needs a destination to send money TO, which is a connected account. Reading the
   * payer here is what let the fraud path charge the victim the collateral it was
   * supposed to award them.
   */
  getTraderPayee(traderId: string): Promise<MerchantRecord | null>;

  /** Req 7.1: record the raising Trader and the disputed-against Trader. */
  recordDisputeParticipants(params: {
    tradeId: string;
    raisedBy: string;
    disputedAgainst: string;
    at: Date;
    /**
     * The raiser's own account of what went wrong (0083).
     *
     * Optional so a caller that predates the column still compiles, and null when the
     * dispute was raised without one. It reaches the arbitration case as "the claim",
     * which is the only thing a trade dispute previously could not supply.
     */
    reason?: string | null;
  }): Promise<void>;

  /**
   * Req 7.2/7.3: record a settled Friction_Tax against the disputed-against
   * hold — increment its captured amount, mark it PARTIALLY_CAPTURED, and store
   * the $10/$10 allocation on the Trade.
   */
  recordFrictionTaxCapture(params: {
    tradeId: string;
    holdRef: string;
    capturedCents: Cents;
    allocation: FrictionTaxAllocation;
  }): Promise<void>;

  /** Req 7.6: record that the Friction_Tax Partial_Capture failed to settle. */
  recordPartialCaptureFailure(params: { tradeId: string }): Promise<void>;

  /**
   * Req 7.3: record the outcome of paying the return-shipping share out to the trader
   * who raised the dispute. Persists the idempotency nonce so a retry reuses it.
   */
  recordFrictionTaxReturnResult(params: {
    tradeId: string;
    nonce: string;
    paid: boolean;
    error?: string;
  }): Promise<void>;

  /** Req 7.7: record that the disputed Item was not returned within the window. */
  recordReturnOverdue(params: { tradeId: string }): Promise<void>;

  /** Req 7.5/8.5: mark a hold VOIDED after a $0 Hold_Void. */
  markHoldVoided(holdRef: string): Promise<void>;

  /** Req 8.1: record the fraud victim (and the offending Trader). */
  recordFraudParticipants(params: {
    tradeId: string;
    victimId: string;
    offendingId: string;
  }): Promise<void>;

  /** Req 8.2/8.3: record a settled Full_Capture against the offending hold. */
  recordFullCapture(params: { holdRef: string; capturedCents: Cents }): Promise<void>;

  /**
   * Req 8.6: the Full_Capture failed after exhausting all retries — preserve the
   * offending hold and flag the Trade for manual reconciliation.
   */
  flagManualReconciliation(params: { tradeId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dependencies + shared result types
// ---------------------------------------------------------------------------

/** Dependencies injected into the dispute/fraud resolution coordinator. */
export interface DisputeResolutionDeps {
  /** Bound Trade Orchestrator used to commit the guarded state transition. */
  orchestrator: TradeOrchestrator;
  repository: DisputeResolutionRepository;
  /** Payment provider for captures, voids, and the victim transfer. */
  payments: PaymentService;
  /** Clock seam for deterministic timestamps in tests; defaults to `Date`. */
  now?: () => Date;
  /** Override the bounded Full_Capture attempt count (Req 8.6). */
  maxFullCaptureAttempts?: number;
}

/**
 * Failure codes surfaced when an operation cannot even begin. The guarded
 * transition's own failures (`INVALID_TRANSITION`, `CONCURRENT_MODIFICATION`,
 * `TRADE_NOT_FOUND`) are passed through unchanged; `NOT_PARTICIPANT` is raised
 * when the actor is neither Trader on the Trade.
 */
export type DisputeResolutionError = OrchestratorError | 'NOT_PARTICIPANT';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the Counterpart of `actorId` on a Trade, or `null` if not a participant. */
function counterpartOf(trade: TradeRecord, actorId: string): string | null {
  const initiator = trade.initiator_id as string | undefined;
  const counterpart = trade.counterpart_id as string | undefined;
  if (actorId === initiator) return counterpart ?? null;
  if (actorId === counterpart) return initiator ?? null;
  return null;
}

/** Find a Trader's hold on a Trade. */
function holdForTrader(holds: DisputeHold[], traderId: string): DisputeHold | undefined {
  return holds.find((hold) => hold.traderId === traderId);
}

// ---------------------------------------------------------------------------
// Condition Dispute (Req 7)
// ---------------------------------------------------------------------------

/** Result of raising a Condition_Dispute (Req 7.1, 7.2, 7.3, 7.6). */
export type RaiseConditionDisputeResult =
  | {
      ok: true;
      trade: TradeRecord;
      /** The disputed-against Trader (Counterpart of the raiser). */
      disputedAgainst: string;
      /** Whether the Friction_Tax Partial_Capture settled (Req 7.3 vs 7.6). */
      frictionTaxSettled: boolean;
      /** The $10/$10 allocation, present only when the capture settled (Req 7.3). */
      allocation?: FrictionTaxAllocation;
      /**
       * Whether the return-shipping share actually reached the raising Trader.
       *
       * `false` with `frictionTaxSettled: true` means the $20 was captured but the $10
       * is still in the platform balance — owed, recorded, and flagged for an operator.
       */
      returnShippingPaid?: boolean;
    }
  | { ok: false; error: DisputeResolutionError | 'HOLD_NOT_FOUND'; detail?: string };

/**
 * Raise a Condition_Dispute during INSPECTION (Req 7.1, 7.2, 7.3, 7.6).
 *
 * 1. Guard the actor is a participant, then commit INSPECTION -> DISPUTED via
 *    the guarded transition core.
 * 2. Record the raising Trader and the disputed-against Trader — the Counterpart
 *    of the raiser (Req 7.1).
 * 3. Request a $20.00 Friction_Tax Partial_Capture from the disputed-against
 *    Trader's hold (Req 7.2).
 * 4. If it settles, allocate $10.00 to the Counterpart and $10.00 to the
 *    Platform_Fee (Req 7.3). If it fails to settle, keep the Trade DISPUTED with
 *    all holds locked and record a Partial_Capture failure indication (Req 7.6)
 *    — this is NOT a transition failure, so the result is still `ok: true`.
 */
export async function raiseConditionDispute(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string; reason?: string | null },
): Promise<RaiseConditionDisputeResult> {
  const { orchestrator, repository, payments } = deps;
  const now = deps.now ?? (() => new Date());

  // 1. Commit the transition to DISPUTED (Req 7.1).
  const transitioned = await orchestrator.applyEvent({
    tradeId: params.tradeId,
    event: 'CONDITION_DISPUTE',
    actorId: params.actorId,
  });
  if (!transitioned.ok) {
    return { ok: false, error: transitioned.error, detail: transitioned.detail };
  }
  const trade = transitioned.trade;

  // The disputed-against Trader is the Counterpart of the raiser (Req 7.1).
  const disputedAgainst = counterpartOf(trade, params.actorId);
  if (!disputedAgainst) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }

  // 2. Record dispute participants (Req 7.1) and the raiser's own account (0083).
  await repository.recordDisputeParticipants({
    tradeId: trade.id,
    raisedBy: params.actorId,
    disputedAgainst,
    at: now(),
    reason: params.reason ?? null,
  });

  // 3. Request the $20.00 Friction_Tax from the disputed-against Trader's hold (Req 7.2).
  const holds = await repository.getHolds(trade.id);
  const disputedHold = holdForTrader(holds, disputedAgainst);
  if (!disputedHold) {
    return { ok: false, error: 'HOLD_NOT_FOUND', detail: disputedAgainst };
  }

  const capture = await payments.partialCapture({
    holdId: disputedHold.holdRef,
    amount: FRICTION_TAX_CENTS,
  });

  // 4a. Failed to settle -> keep DISPUTED, holds locked, record indication (Req 7.6).
  if (capture.status !== 'SETTLED') {
    await repository.recordPartialCaptureFailure({ tradeId: trade.id });
    return { ok: true, trade, disputedAgainst, frictionTaxSettled: false };
  }

  // 4b. Settled -> allocate $10 return shipping + $10 platform fee (Req 7.3).
  const allocation: FrictionTaxAllocation = {
    returnShippingCents: FRICTION_TAX_RETURN_SHIPPING_CENTS,
    platformFeeCents: FRICTION_TAX_PLATFORM_FEE_CENTS,
  };
  await repository.recordFrictionTaxCapture({
    tradeId: trade.id,
    holdRef: disputedHold.holdRef,
    capturedCents: capture.amount,
    allocation,
  });

  // 4c. PAY the return-shipping share to the trader who raised the dispute (Req 7.3).
  //
  // This step did not exist. The allocation was written to the trade and read back only
  // for display, so the platform captured $20 and kept all of it, while the trader who
  // has to post the item back was under-compensated by the $10 the requirement gives
  // them. "Allocated" is not "paid": nothing moved the money.
  //
  // The RAISING trader is the payee because they are the one returning the goods — the
  // dispute is theirs, the item came to them, and the return postage is theirs to
  // cover. The other $10 is the platform's fee and correctly stays put.
  const returnShippingPaid = await payReturnShippingShare(deps, {
    tradeId: trade.id,
    payeeTraderId: params.actorId,
    amountCents: allocation.returnShippingCents,
  });

  return {
    ok: true,
    trade,
    disputedAgainst,
    frictionTaxSettled: true,
    allocation,
    returnShippingPaid,
  };
}

/**
 * Pay the captured return-shipping share out to the trader who raised the dispute.
 *
 * `payoutToMerchant`, never `requestTransfer`: the $10 is already in the platform
 * balance because it was just captured from the other trader's collateral, so this
 * releases money we hold. Charging the recipient instead is the mistake the fraud path
 * shipped, and it is the same shape of call.
 *
 * Never throws, and never rolls the dispute back — the dispute is valid whether or not
 * the small compensating payment lands. A failure is recorded and flagged so it is owed
 * visibly rather than silently.
 */
async function payReturnShippingShare(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; payeeTraderId: string; amountCents: Cents },
): Promise<boolean> {
  const { repository, payments } = deps;
  if (params.amountCents <= 0) return true;

  const nonce = `friction-return:${params.tradeId}`;
  const payee = await repository.getTraderPayee(params.payeeTraderId);

  if (!canReceiveFunds(payee)) {
    await repository.recordFrictionTaxReturnResult({
      tradeId: params.tradeId,
      nonce,
      paid: false,
      error: 'The trader has no payout account that can receive the return-shipping share.',
    });
    await repository.flagManualReconciliation({ tradeId: params.tradeId });
    return false;
  }

  const payout = await payments.payoutToMerchant({
    merchantRef: payee!.merchantRef!,
    amount: params.amountCents,
    ref: `friction-return:${params.tradeId}`,
    // Persisted, and reused verbatim on any retry.
    nonce,
  });

  if (payout.status !== 'SETTLED') {
    await repository.recordFrictionTaxReturnResult({
      tradeId: params.tradeId,
      nonce,
      paid: false,
      error: 'The provider declined the return-shipping payout.',
    });
    await repository.flagManualReconciliation({ tradeId: params.tradeId });
    return false;
  }

  await repository.recordFrictionTaxReturnResult({
    tradeId: params.tradeId,
    nonce,
    paid: true,
  });
  return true;
}

/** Result of resolving a Condition_Dispute by recorded return (Req 7.5). */
export type ResolveConditionDisputeResult =
  | { ok: true; trade: TradeRecord; voidedHoldRefs: string[] }
  | { ok: false; error: DisputeResolutionError; detail?: string };

/**
 * Resolve a Condition_Dispute when the disputed Item is recorded returned within
 * the 14-day window (Req 7.5): commit DISPUTED -> COMPLETED, then request a $0
 * Hold_Void for the remaining hold of the disputed-against Trader and for the
 * raising Trader's hold.
 *
 * The remaining hold amounts stay locked up to this point (Req 7.4); this is the
 * step that releases them.
 */
export async function resolveConditionDispute(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string },
): Promise<ResolveConditionDisputeResult> {
  const { orchestrator, repository, payments } = deps;

  const transitioned = await orchestrator.applyEvent({
    tradeId: params.tradeId,
    event: 'DISPUTE_RESOLVED',
    actorId: params.actorId,
  });
  if (!transitioned.ok) {
    return { ok: false, error: transitioned.error, detail: transitioned.detail };
  }
  const trade = transitioned.trade;

  // Void the disputed-against Trader's remaining hold and the raising Trader's
  // hold (Req 7.5). Prefer the recorded participants; fall back to voiding every
  // still-live hold on the Trade so no collateral is left stranded.
  const raisedBy = trade.dispute_raised_by as string | undefined;
  const disputedAgainst = trade.disputed_against as string | undefined;
  const targetTraders = [raisedBy, disputedAgainst].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  const holds = await repository.getHolds(trade.id);
  const toVoid =
    targetTraders.length > 0
      ? holds.filter((hold) => targetTraders.includes(hold.traderId))
      : holds;

  const voidedHoldRefs: string[] = [];
  for (const hold of toVoid) {
    if (hold.status === 'VOIDED' || hold.status === 'FULLY_CAPTURED') continue;
    // The RETURNED STATUS DECIDES. `voidHold` reports failure through `status`
    // rather than throwing, and this loop used to discard it and mark the row
    // VOIDED regardless — so a trader's collateral could stay a live authorisation
    // against their card while the system said it had been released. The expiry
    // reconciler only sweeps holds still marked ACTIVE, so it could not find one
    // either: the encumbrance became invisible until the authorisation lapsed.
    const released = await payments.voidHold(hold.holdRef);
    if (released.status !== 'VOIDED') {
      // Left ACTIVE deliberately, so `expire_lapsed_holds` still owns it and the
      // trader is warned before it lapses.
      await repository.flagManualReconciliation({ tradeId: trade.id });
      continue;
    }
    await repository.markHoldVoided(hold.holdRef);
    voidedHoldRefs.push(hold.holdRef);
  }

  return { ok: true, trade, voidedHoldRefs };
}

/**
 * Record a return-overdue indication when the disputed Item is not returned
 * within 14 calendar days of the transition to DISPUTED (Req 7.7). The Trade
 * stays DISPUTED and all remaining hold amounts stay locked; only the indication
 * is recorded. Intended to be driven by a scheduled/timer check, so it takes no
 * state transition.
 */
export async function markDisputeReturnOverdue(
  deps: DisputeResolutionDeps,
  params: { tradeId: string },
): Promise<{ ok: true }> {
  await deps.repository.recordReturnOverdue({ tradeId: params.tradeId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Objective Fraud (Req 8)
// ---------------------------------------------------------------------------

/** An error indication surfaced by fraud resolution (Req 8.6, 8.7). */
/**
 * Error indications surfaced from a fraud resolution without rolling the
 * transition back (Req 8.6).
 *
 * `MISSING_IDENTITY_DATA` is gone along with the identity-disclosure step it
 * described — there is no longer any identity data to be missing.
 */
export type FraudIndication =
  | 'FULL_CAPTURE_FAILED'
  /**
   * The collateral was captured but the victim has no Connect destination that can
   * receive it, so it stays in the platform balance pending their payout setup.
   */
  | 'VICTIM_NOT_PAYABLE'
  /** The payout to the victim was attempted and the provider refused it. */
  | 'VICTIM_TRANSFER_FAILED'
  /** A hold that should have been released reported a failed void (Req 8.5). */
  | 'HOLD_VOID_FAILED';

/** The aggregate outcome of resolving Objective_Fraud (Req 8.2-8.7). */
export interface FraudResolutionOutcome {
  trade: TradeRecord;
  /** The offending Trader whose collateral is captured (Counterpart of the reporter). */
  offendingTraderId: string;
  /** The victim Trader (the reporter) who receives the captured funds. */
  victimTraderId: string;
  /** Whether the Full_Capture settled within the bounded retries (Req 8.2, 8.6). */
  fullCaptureSettled: boolean;
  /** Number of Full_Capture attempts made (Req 8.6). */
  fullCaptureAttempts: number;
  /** Whether the captured funds were transferred to the victim (Req 8.3). */
  transferSettled: boolean;
  /** Whether the victim's hold was voided (Req 8.5). */
  victimHoldVoided: boolean;
  /** Whether the Trade was flagged for manual reconciliation (Req 8.6). */
  manualReconciliation: boolean;
  /** Error indications to surface to the caller (Req 8.6, 8.7). */
  indications: FraudIndication[];
}

/** Result of reporting Objective_Fraud. */
export type ReportFraudResult =
  | { ok: true; outcome: FraudResolutionOutcome }
  | { ok: false; error: DisputeResolutionError | 'HOLD_NOT_FOUND'; detail?: string };

/**
 * Report Objective_Fraud from INSPECTION or DISPUTED (Req 8.1-8.7).
 *
 * The reporter (`actorId`) is the victim; the offending Trader is the
 * Counterpart. The Trade transitions to FRAUD_RESOLVED first (Req 8.1); the
 * post-transition side effects then run and NEVER roll the state back — failures
 * are recorded as indications:
 *
 * - Full_Capture of 100% of the offending hold, retried up to the bounded limit
 *   (Req 8.2, 8.6). On exhaustion: preserve the offending hold, flag the Trade
 *   for manual reconciliation, and surface `FULL_CAPTURE_FAILED`.
 * - On a settled capture, transfer the captured funds to the victim (Req 8.3).
 * - Void the victim's hold at $0 (Req 8.5).
 *
 * Req 8.4/8.7 (generate a Police_Evidence_Pack from the offending Trader's
 * verified identity) is NOT implemented and has been deliberately withdrawn — see
 * the note at the former step 5. The requirement itself needs amending.
 */
export async function reportObjectiveFraud(
  deps: DisputeResolutionDeps,
  params: {
    tradeId: string;
    /** The OPERATOR making the determination. Recorded for audit only. */
    actorId: string;
    /**
     * The trader the operator determined was defrauded. Their counterpart's
     * collateral is captured and paid to them.
     *
     * REQUIRED, and deliberately not derived from `actorId`. This function used to
     * treat its caller as the victim, and the caller was any participant — so a
     * trader could name themselves the victim and take the other side's collateral
     * with no review. The victim is now an operator's finding, and `actorId` is the
     * operator, who is not a party to the trade at all.
     */
    victimId: string;
  },
): Promise<ReportFraudResult> {
  const { orchestrator, repository, payments } = deps;
  const maxAttempts = deps.maxFullCaptureAttempts ?? MAX_FULL_CAPTURE_ATTEMPTS;
  // No clock seam here: fraud resolution records no timestamp of its own. Every
  // instant it cares about is written by the repository or the state machine.

  // 1. Commit the transition to FRAUD_RESOLVED (Req 8.1).
  const transitioned = await orchestrator.applyEvent({
    tradeId: params.tradeId,
    event: 'FRAUD_CONFIRMED',
    actorId: params.actorId,
  });
  if (!transitioned.ok) {
    return { ok: false, error: transitioned.error, detail: transitioned.detail };
  }
  const trade = transitioned.trade;

  // The victim must be a party to the trade; the offender is whoever they are not.
  // Validated against the trade rather than assumed, so an operator cannot name an
  // unrelated account as the beneficiary of a capture.
  const offendingTraderId = counterpartOf(trade, params.victimId);
  if (!offendingTraderId) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  const victimTraderId = params.victimId;

  await repository.recordFraudParticipants({
    tradeId: trade.id,
    victimId: victimTraderId,
    offendingId: offendingTraderId,
  });

  const holds = await repository.getHolds(trade.id);
  const offendingHold = holdForTrader(holds, offendingTraderId);
  const victimHold = holdForTrader(holds, victimTraderId);
  if (!offendingHold) {
    return { ok: false, error: 'HOLD_NOT_FOUND', detail: offendingTraderId };
  }

  const indications: FraudIndication[] = [];

  // 2. Full_Capture 100% of the offending hold, bounded retry (Req 8.2, 8.6).
  //
  // WHAT THIS LOOP CAN AND CANNOT RECOVER, because it is easy to over-read.
  //
  // Every attempt sends the SAME idempotency key (`capture:full:<holdId>`), which is
  // deliberate — a capture must never be able to run twice. The consequence is that it
  // only helps against a failure where NOTHING reached the provider (a thrown transport
  // error, which the binding converts to a FAILED status). Where the provider returned a
  // definite rejection, that response is cached against the key and attempts 2 and 3
  // replay the same rejection immediately.
  //
  // So this is a transport retry, not a "try until it works" loop, and exhausting it
  // flags manual reconciliation rather than implying the money is unrecoverable. Do not
  // "improve" it by varying the key per attempt: that trades a recoverable operator task
  // for the possibility of capturing a trader's collateral twice.
  let fullCaptureSettled = false;
  let capturedCents = 0;
  let attempts = 0;
  while (attempts < maxAttempts && !fullCaptureSettled) {
    attempts += 1;
    const capture = await payments.fullCapture(offendingHold.holdRef);
    if (capture.status === 'SETTLED') {
      fullCaptureSettled = true;
      capturedCents = capture.amount;
    }
  }

  let transferSettled = false;
  let manualReconciliation = false;
  if (fullCaptureSettled) {
    await repository.recordFullCapture({
      holdRef: offendingHold.holdRef,
      capturedCents,
    });

    // 3. Pay the captured funds OUT to the victim (Req 8.3).
    //
    // `payoutToMerchant`, NOT `requestTransfer`. This previously called
    // `requestTransfer({ payerId: victimPayerId, ... })`, which is a COLLECTION
    // primitive: it creates a PaymentIntent against the given customer's saved card
    // and, with no `merchantRef`, returns SETTLED once that charge succeeds. So a
    // confirmed fraud finding captured the offender's collateral and then DEBITED
    // THE VICTIM for the same amount, reported success, and left the platform
    // holding both sides. It is the exact mistake `payoutCashSaleSeller` documents
    // at its own call site.
    //
    // The captured collateral is already in the platform balance, so releasing it
    // is a payout of money we hold — never a fresh charge.
    const victimPayee = await repository.getTraderPayee(victimTraderId);
    if (!canReceiveFunds(victimPayee)) {
      // Recoverable and deliberately not a silent success: the funds stay in the
      // platform balance and the case is flagged, so a victim who has not finished
      // payout onboarding is paid once they do rather than being charged now.
      manualReconciliation = true;
      indications.push('VICTIM_NOT_PAYABLE');
      await repository.flagManualReconciliation({ tradeId: trade.id });
    } else {
      const payout = await payments.payoutToMerchant({
        merchantRef: victimPayee!.merchantRef!,
        amount: capturedCents,
        ref: `fraud-payout:${trade.id}`,
        nonce: `fraud-payout:${trade.id}`,
      });
      transferSettled = payout.status === 'SETTLED';
      if (!transferSettled) {
        // Payouts report failure through `status` rather than throwing (Req 8.6),
        // so an unchecked call here would have recorded a payment that never landed.
        manualReconciliation = true;
        indications.push('VICTIM_TRANSFER_FAILED');
        await repository.flagManualReconciliation({ tradeId: trade.id });
      }
    }
  } else {
    // Exhausted all retries -> preserve the offending hold, flag manual
    // reconciliation, surface the error indication (Req 8.6).
    manualReconciliation = true;
    indications.push('FULL_CAPTURE_FAILED');
    await repository.flagManualReconciliation({ tradeId: trade.id });
  }

  // 4. Void the victim's hold at $0 (Req 8.5).
  //
  // The victim has already been defrauded; leaving their collateral authorised
  // while telling them it was released is the last thing this flow should do, so
  // the returned status is checked rather than assumed. See the same fix in
  // `resolveConditionDispute`.
  let victimHoldVoided = false;
  if (victimHold && victimHold.status !== 'VOIDED') {
    const released = await payments.voidHold(victimHold.holdRef);
    if (released.status === 'VOIDED') {
      await repository.markHoldVoided(victimHold.holdRef);
      victimHoldVoided = true;
    } else {
      manualReconciliation = true;
      indications.push('HOLD_VOID_FAILED');
      await repository.flagManualReconciliation({ tradeId: trade.id });
    }
  }

  // NOTE: there is deliberately no identity-disclosure step here.
  //
  // This flow previously generated a "Police_Evidence_Pack" — a PDF carrying the
  // accused Trader's legal name, date of birth and government document number —
  // and `downloadEvidencePack` exposed it to any trade PARTICIPANT. That meant a
  // victim could obtain the accused's identity documents on the strength of an
  // in-app fraud determination, with no court order and no appeal. Harmless while
  // the identity data was simulated; a real disclosure problem once provider
  // identity verification made it genuine.
  //
  // Removed rather than restricted, so the platform never reads verified identity
  // fields at all: identity verification is now pass/fail only. If a lawful
  // request for identity data arrives, it should be served by a human out of band,
  // not by a download button.

  return {
    ok: true,
    outcome: {
      trade,
      offendingTraderId,
      victimTraderId,
      fullCaptureSettled,
      fullCaptureAttempts: attempts,
      transferSettled,
      victimHoldVoided,
      manualReconciliation,
      indications,
    },
  };
}

// ---------------------------------------------------------------------------
// Bound coordinator
// ---------------------------------------------------------------------------

/** A dispute/fraud resolution coordinator with its dependencies pre-wired. */
export interface DisputeResolutionOrchestrator {
  raiseConditionDispute(params: {
    tradeId: string;
    actorId: string;
    /** The raiser's own account of what went wrong (0083). */
    reason?: string | null;
  }): Promise<RaiseConditionDisputeResult>;
  resolveConditionDispute(params: {
    tradeId: string;
    actorId: string;
  }): Promise<ResolveConditionDisputeResult>;
  markDisputeReturnOverdue(params: { tradeId: string }): Promise<{ ok: true }>;
  reportObjectiveFraud(params: {
    tradeId: string;
    /** The operator making the determination. */
    actorId: string;
    /** The trader the operator found was defrauded. Never inferred from the caller. */
    victimId: string;
  }): Promise<ReportFraudResult>;
}

/**
 * Bind the dispute/fraud resolution operations to a set of dependencies. Tests
 * wire an in-memory fake repository + fake payment/KYC service + in-memory
 * evidence-pack generator here; production wires the Supabase admin binding (see
 * `supabaseDisputeResolutionRepository.ts`).
 */
export function createDisputeResolutionOrchestrator(
  deps: DisputeResolutionDeps,
): DisputeResolutionOrchestrator {
  return {
    raiseConditionDispute: (params) => raiseConditionDispute(deps, params),
    resolveConditionDispute: (params) => resolveConditionDispute(deps, params),
    markDisputeReturnOverdue: (params) => markDisputeReturnOverdue(deps, params),
    reportObjectiveFraud: (params) => reportObjectiveFraud(deps, params),
  };
}
