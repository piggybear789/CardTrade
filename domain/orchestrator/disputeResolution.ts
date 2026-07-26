// domain/orchestrator/disputeResolution.ts
//
// Condition-dispute (Req 7) and objective-fraud (Req 8) resolution for the
// 2-Way Trade escrow.
//
// Like the other orchestration modules, this is a pure/injectable coordination
// layer: it depends only on *interfaces* — a bound `TradeOrchestrator` (for the
// guarded state-machine transition), a `DisputeResolutionRepository` (for the
// dispute/fraud-specific reads/writes), the `PaymentService` (captures/voids/
// transfers), the `KycService` (verified identity for the evidence pack), and an
// `EvidencePackGenerator` (the PDF seam). The concrete Supabase admin binding
// lives in `supabaseDisputeResolutionRepository.ts`, which is the only file that
// pulls in `server-only`.
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

import type { Cents, KycService, PaymentService, PreAuthHold } from '../services/types';
import type { OrchestratorError, TradeOrchestrator, TradeRecord } from './tradeOrchestrator';
import type { EvidencePackGenerator } from './evidencePack';

// ---------------------------------------------------------------------------
// Constants (Req 7.2, 7.3, 8.6)
// ---------------------------------------------------------------------------

/** The fixed Friction_Tax Partial_Capture on a Condition_Dispute: $20.00 (Req 7.2). */
export const FRICTION_TAX_CENTS: Cents = 2000;

/** Friction_Tax allocation to the Counterpart for return shipping: $10.00 (Req 7.3). */
export const FRICTION_TAX_RETURN_SHIPPING_CENTS: Cents = 1000;

/** Friction_Tax allocation to the Platform_Fee: $10.00 (Req 7.3). */
export const FRICTION_TAX_PLATFORM_FEE_CENTS: Cents = 1000;

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
   * Read a Trader's provider payer reference, used as the transfer destination
   * when paying captured fraud collateral to the victim (Req 8.3). `null` when
   * the Trader has no payer on file.
   */
  getTraderPayerId(traderId: string): Promise<string | null>;

  /** Req 7.1: record the raising Trader and the disputed-against Trader. */
  recordDisputeParticipants(params: {
    tradeId: string;
    raisedBy: string;
    disputedAgainst: string;
    at: Date;
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

  /** Req 8.4/8.7: record the evidence-pack Storage path and completeness. */
  recordEvidencePack(params: {
    tradeId: string;
    storagePath: string | null;
    complete: boolean;
  }): Promise<void>;
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
  /** KYC provider supplying verified identity for the evidence pack (Req 8.4). */
  kyc: KycService;
  /** The Police_Evidence_Pack PDF generator seam (Req 8.4). */
  evidencePack: EvidencePackGenerator;
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
  params: { tradeId: string; actorId: string },
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

  // 2. Record dispute participants (Req 7.1).
  await repository.recordDisputeParticipants({
    tradeId: trade.id,
    raisedBy: params.actorId,
    disputedAgainst,
    at: now(),
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

  return { ok: true, trade, disputedAgainst, frictionTaxSettled: true, allocation };
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
    await payments.voidHold(hold.holdRef);
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
export type FraudIndication = 'FULL_CAPTURE_FAILED' | 'MISSING_IDENTITY_DATA';

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
  /** Whether the evidence pack is complete (false when identity data is missing, Req 8.7). */
  evidencePackComplete: boolean;
  /** Storage path of the generated evidence pack, or `null` when incomplete (Req 8.4, 8.7). */
  evidencePackPath: string | null;
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
 * - Generate a Police_Evidence_Pack PDF from the offending Trader's verified
 *   identity (Req 8.4). If the KYC_Service returns no identity, mark the pack
 *   incomplete and surface `MISSING_IDENTITY_DATA` (Req 8.7).
 */
export async function reportObjectiveFraud(
  deps: DisputeResolutionDeps,
  params: { tradeId: string; actorId: string },
): Promise<ReportFraudResult> {
  const { orchestrator, repository, payments, kyc, evidencePack } = deps;
  const maxAttempts = deps.maxFullCaptureAttempts ?? MAX_FULL_CAPTURE_ATTEMPTS;
  const now = deps.now ?? (() => new Date());

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

  const offendingTraderId = counterpartOf(trade, params.actorId);
  if (!offendingTraderId) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  const victimTraderId = params.actorId;

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
    // 3. Transfer the captured funds to the victim (Req 8.3). Pay the victim's
    //    payer on file; fall back to the trader id if none is recorded.
    const victimPayerId = (await repository.getTraderPayerId(victimTraderId)) ?? victimTraderId;
    const transfer = await payments.requestTransfer({
      payerId: victimPayerId,
      amount: capturedCents,
      ref: `fraud-payout:${trade.id}`,
      nonce: `fraud-payout:${trade.id}`,
    });
    transferSettled = transfer.status === 'SETTLED';
  } else {
    // Exhausted all retries -> preserve the offending hold, flag manual
    // reconciliation, surface the error indication (Req 8.6).
    manualReconciliation = true;
    indications.push('FULL_CAPTURE_FAILED');
    await repository.flagManualReconciliation({ tradeId: trade.id });
  }

  // 4. Void the victim's hold at $0 (Req 8.5).
  let victimHoldVoided = false;
  if (victimHold && victimHold.status !== 'VOIDED') {
    await payments.voidHold(victimHold.holdRef);
    await repository.markHoldVoided(victimHold.holdRef);
    victimHoldVoided = true;
  }

  // 5. Generate the Police_Evidence_Pack from verified identity data (Req 8.4).
  const identity = await kyc.getVerifiedIdentity(offendingTraderId);
  let evidencePackComplete = false;
  let evidencePackPath: string | null = null;
  if (!identity) {
    // Missing identity data -> incomplete pack + error indication (Req 8.7).
    indications.push('MISSING_IDENTITY_DATA');
    await repository.recordEvidencePack({
      tradeId: trade.id,
      storagePath: null,
      complete: false,
    });
  } else {
    const doc = await evidencePack.generate({
      tradeId: trade.id,
      offendingIdentity: identity,
      victimTraderId,
      generatedAt: now().toISOString(),
    });
    evidencePackComplete = true;
    evidencePackPath = doc.storagePath;
    await repository.recordEvidencePack({
      tradeId: trade.id,
      storagePath: doc.storagePath,
      complete: true,
    });
  }

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
      evidencePackComplete,
      evidencePackPath,
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
  }): Promise<RaiseConditionDisputeResult>;
  resolveConditionDispute(params: {
    tradeId: string;
    actorId: string;
  }): Promise<ResolveConditionDisputeResult>;
  markDisputeReturnOverdue(params: { tradeId: string }): Promise<{ ok: true }>;
  reportObjectiveFraud(params: {
    tradeId: string;
    actorId: string;
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
