'use server';

// lib/actions/trades.ts
//
// Next.js Server Actions for the 2-Way Trade escrow (Req 5, 6, 7, 8). These are
// deliberately THIN wrappers: each one authenticates the caller, verifies (where
// relevant) that they participate in the Trade, then delegates to a domain
// orchestrator. All transition rules, payment side effects, hold sizing, and
// audit writes live in the orchestrators — never here.
//
// Authorization model:
//   * The cookie-bound server client (`createClient`) loads the Trade under RLS,
//     which grants READ only to the two participating Traders (Req 9.6/9.7).
//     A non-participant therefore simply sees no row, which we surface as
//     `not-participant`.
//   * The guarded writes themselves run through the service-role admin-backed
//     orchestrators, because a valid Trade write must pass state-machine
//     validation, trigger payment side effects, and append the audit row
//     atomically (direct client UPDATEs on `trades` are not granted).
//
// All monetary amounts are integer AUD cents.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveEvent } from '@/domain/state-machine/guards';
import type { TradeState, TradeViewerRole } from '@/domain/state-machine/types';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { proposeTradeWithSupabase } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import {
  createDefaultDisputeResolutionOrchestrator,
  EVIDENCE_PACK_BUCKET,
} from '@/domain/orchestrator/supabaseDisputeResolutionRepository';
import type {
  DisputeResolutionError,
  FraudResolutionOutcome,
  FrictionTaxAllocation,
} from '@/domain/orchestrator/disputeResolution';
import type { OrchestratorError } from '@/domain/orchestrator/tradeOrchestrator';
import type { ProposeTradeError } from '@/domain/orchestrator/tradeProposal';
import { getPaymentService, isLivePaymentsProvider } from '@/domain/services';
import { canReceiveFunds } from '@/domain/orchestrator/merchantOnboarding';
import { createSupabaseMerchantRepository } from '@/domain/orchestrator/supabaseMerchantRepository';
import { createSupabaseTradeProposalRepository } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import {
  factsFromTrade,
  hasRecorded,
  recordLifecycleTimestamp,
  roleForUser,
  type LifecycleAction,
  type TradeRow,
} from './tradeLifecycleStore';
import {
  areHandoverTermsComplete,
  toHandoverColumns,
  type HandoverMethod,
} from '@/lib/handover/terms';
import { DEAL_DELIVERY_COST_MAX } from '@/lib/marketplace-constants';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

/** Errors common to the authentication + participant guard. */
export type AuthError = 'unauthenticated' | 'not-participant';

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Internal auth + participant guard (not a server action)
// ---------------------------------------------------------------------------

type ParticipantContext = {
  userId: string;
  trade: TradeRow;
  role: TradeViewerRole;
};

/**
 * Resolve the authenticated user and confirm they participate in the Trade.
 * Returns the loaded Trade row and the caller's role, or a typed failure.
 * Because RLS hides Trades from non-participants, a missing row is reported as
 * `not-participant` (Req 9.7).
 */
async function requireParticipant(
  tradeId: string,
): Promise<{ ok: true; ctx: ParticipantContext } | ActionFailure<AuthError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: trade } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .maybeSingle();
  if (!trade) return { ok: false, error: 'not-participant' };

  const role = roleForUser(trade as TradeRow, user.id);
  if (!role) return { ok: false, error: 'not-participant' };

  return { ok: true, ctx: { userId: user.id, trade: trade as TradeRow, role } };
}

// ---------------------------------------------------------------------------
// ensureTradeConversation — open the trade's chat thread on demand
// (demo-contract-ux Req 1, 2: an accepted Trade is a contract room just like a
// Cash_Sale or Deal, so it gets the same participant-only chat.)
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link ensureTradeConversation}. */
export type EnsureTradeConversationError = AuthError | 'persistence-error';

/** Result of {@link ensureTradeConversation}. */
export type EnsureTradeConversationResult =
  | { ok: true; conversationId: string }
  | ActionFailure<EnsureTradeConversationError>;

/**
 * Resolve the trade's chat thread, creating and linking it if needed.
 *
 * Trades accepted before this thread existed (or an interrupted first view)
 * have no linked conversation, so `TradeContract` calls this on first view —
 * the same self-healing path the cash sale and deal contract rooms use.
 * Authorization is enforced twice: the participant guard here, and again
 * inside the `ensure_trade_conversation` RPC.
 */
export async function ensureTradeConversation(
  tradeId: string,
): Promise<EnsureTradeConversationResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;
  const { trade, userId } = guard.ctx;

  if (trade.conversation_id) {
    return { ok: true, conversationId: trade.conversation_id };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('ensure_trade_conversation', {
      p_trade_id: tradeId,
      p_actor_id: userId,
    });
    if (error || !data) {
      return {
        ok: false,
        error: 'persistence-error',
        detail: 'Chat could not be opened.',
      };
    }
    return { ok: true, conversationId: data as string };
  } catch {
    return {
      ok: false,
      error: 'persistence-error',
      detail: 'Chat could not be opened.',
    };
  }
}

// ---------------------------------------------------------------------------
// Trade proposal (Req 5.1, 5.2, 5.3)
// ---------------------------------------------------------------------------

/** Result of {@link proposeTrade}. */
export type ProposeTradeActionResult =
  | { ok: true; tradeId: string }
  | ActionFailure<AuthError | ProposeTradeError>;

/**
 * Propose a 2-Way Trade pairing the caller's own Item with a Counterpart's Item
 * (Req 5.1, 5.2, 5.3). The authenticated user is the proposing (initiator)
 * Trader. Delegates the equal-FMV / both-AVAILABLE guards, Trade creation, item
 * reservation, and bond placement to the proposal orchestrator (revised Req 5.4:
 * KYC VERIFIED Traders are bond-exempt, everyone else bonds against their own
 * Item's FMV).
 *
 * When BOTH Traders are verified no bond is placed, so no provider webhook will
 * arrive to confirm collateral — this action dispatches HOLDS_CONFIRMED itself so
 * the Trade moves straight to COLLATERAL_LOCKED.
 */
export async function proposeTrade(
  initiatorItemId: string,
  counterpartItemId: string,
  options?: {
    /**
     * Further Items in the initiator's bundle. Counted into the Counterpart's
     * Bond, because the Counterpart receives all of them.
     */
    initiatorExtraItemIds?: string[];
    /**
     * Create the Trade on behalf of another Trader.
     *
     * Set only by `acceptTradeProposal`, where the accepting Counterpart is the
     * caller but the *proposer* is the initiating Trader. The caller's own
     * entitlement is established there by re-validating the PENDING proposal
     * they are party to, so this must never be threaded through from client
     * input.
     */
    onBehalfOfUserId?: string;
  },
): Promise<ProposeTradeActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const initiatorId = options?.onBehalfOfUserId ?? user.id;

  const result = await proposeTradeWithSupabase(getPaymentService(), {
    proposerId: initiatorId,
    initiatorItemId,
    initiatorExtraItemIds: options?.initiatorExtraItemIds ?? [],
    counterpartItemId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };

  if (result.bondsRequired === 0) {
    // No collateral to wait on: lock the trade now. A rejected transition is not
    // fatal — the Trade still exists in COLLATERAL_PENDING and can be retried.
    const orchestrator = createDefaultTradeOrchestrator({ payments: getPaymentService() });
    await orchestrator.applyEvent({
      tradeId: result.trade.id,
      event: 'HOLDS_CONFIRMED',
      actorId: initiatorId,
    });
  } else if (isLivePaymentsProvider()) {
    // Pinch realtime charges return synchronously. Advance the trade from the
    // hold rows instead of waiting for a webhook (or the mock DemoPanel).
    await syncTradeHoldsFromPinch(result.trade.id, initiatorId);
  }

  return { ok: true, tradeId: result.trade.id };
}

/**
 * After Pinch `POST /payments/realtime`, hold rows already reflect ACTIVE/FAILED.
 * Drive HOLDS_CONFIRMED / HOLDS_FAILED from that truth so trades leave
 * COLLATERAL_PENDING without a fake webhook button.
 */
async function syncTradeHoldsFromPinch(tradeId: string, actorId: string): Promise<void> {
  const admin = createAdminClient();
  const repository = createSupabaseTradeProposalRepository(admin);
  const holds = await repository.getHolds(tradeId);
  if (holds.length === 0) return;

  const orchestrator = createDefaultTradeOrchestrator({ payments: getPaymentService() });
  if (holds.every((h) => h.status === 'ACTIVE')) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
    return;
  }
  if (holds.some((h) => h.status === 'FAILED')) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_FAILED', actorId });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle actions: shipment / receipt / acceptance (Req 6.1-6.8)
// ---------------------------------------------------------------------------

/** Errors surfaced by a lifecycle recording action. */
export type LifecycleError = AuthError | 'not-permitted' | 'already-recorded' | OrchestratorError;

/** Result of a lifecycle recording action. */
export type LifecycleActionResult =
  | { ok: true; state: TradeState; transitioned: boolean }
  | ActionFailure<LifecycleError>;

/**
 * Record one leg of a lifecycle action for the caller and, once both Traders
 * have acted, dispatch the aggregate transition (Req 6.1-6.8).
 *
 * Steps:
 *   1. Authenticate + confirm participation.
 *   2. Reject if the Trade is not in the state that permits the action, or if
 *      the caller has already recorded it (Req 6.8).
 *   3. Persist the caller's own timestamp through a guarded, once-only write.
 *   4. Recompute the aggregate facts; if both sides have now acted, derive the
 *      aggregate event (BOTH_SHIPPED / BOTH_RECEIVED / BOTH_ACCEPTED) and commit
 *      the transition via the trade orchestrator (Req 6.2/6.4/6.6).
 */
async function recordLifecycle(
  tradeId: string,
  action: LifecycleAction,
  shipment?: { carrier: string; trackingNumber: string; trackingUrl?: string | null },
): Promise<LifecycleActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;
  const { userId, trade, role } = guard.ctx;

  const requiredStateByAction: Record<LifecycleAction, TradeState> = {
    shipment: 'COLLATERAL_LOCKED',
    receipt: 'IN_TRANSIT',
    acceptance: 'INSPECTION',
  };

  // Action must be permitted in the current state (Req 6.8).
  if (trade.state !== requiredStateByAction[action]) {
    return { ok: false, error: 'not-permitted' };
  }
  // Once-only per trader (Req 6.1/6.3/6.5, 6.8).
  if (hasRecorded(trade, action, role)) {
    return { ok: false, error: 'already-recorded' };
  }

  let extra: TablesUpdate<'trades'> | undefined;
  if (action === 'shipment' && trade.handover_method === 'DELIVERY') {
    const carrier = shipment?.carrier.trim() ?? '';
    const trackingNumber = shipment?.trackingNumber.trim() ?? '';
    if (!carrier || trackingNumber.length < 2) {
      return { ok: false, error: 'not-permitted', detail: 'Carrier and tracking number are required for delivery.' };
    }
    extra =
      role === 'INITIATOR'
        ? {
            initiator_tracking_carrier: carrier,
            initiator_tracking_number: trackingNumber,
            initiator_tracking_url: shipment?.trackingUrl?.trim() || null,
          }
        : {
            counterpart_tracking_carrier: carrier,
            counterpart_tracking_number: trackingNumber,
            counterpart_tracking_url: shipment?.trackingUrl?.trim() || null,
          };
  } else if (action === 'shipment' && shipment) {
    const carrier = shipment.carrier.trim();
    const trackingNumber = shipment.trackingNumber.trim();
    if (carrier && trackingNumber.length >= 2) {
      extra =
        role === 'INITIATOR'
          ? {
              initiator_tracking_carrier: carrier,
              initiator_tracking_number: trackingNumber,
              initiator_tracking_url: shipment.trackingUrl?.trim() || null,
            }
          : {
              counterpart_tracking_carrier: carrier,
              counterpart_tracking_number: trackingNumber,
              counterpart_tracking_url: shipment.trackingUrl?.trim() || null,
            };
    }
  }

  // Persist the caller's own timestamp; the guarded write also enforces
  // once-only + state under concurrency.
  const write = await recordLifecycleTimestamp({ tradeId, action, role, extra });
  if (!write.recorded) {
    return { ok: false, error: 'already-recorded' };
  }

  // Derive the aggregate event from the freshly updated row. When only one side
  // has acted, there is no transition yet — the recording itself is the result.
  const event = deriveEvent(write.trade.state, factsFromTrade(write.trade));
  if (!event) {
    return { ok: true, state: write.trade.state, transitioned: false };
  }

  const orchestrator = createDefaultTradeOrchestrator({ payments: getPaymentService() });
  const result = await orchestrator.applyEvent({ tradeId, event, actorId: userId });
  if (!result.ok) {
    return { ok: false, error: result.error, detail: result.detail };
  }

  // Req 6.7: on BOTH_ACCEPTED -> COMPLETED, release every Pre_Auth_Hold on this
  // Trade at $0 cost. This mirrors the dispute/fraud paths' hold-void step,
  // which was already implemented — the plain successful-completion path was
  // the one place Req 6.7 had never been wired up. With real collateral now a
  // genuine charge (see PinchService), skipping this would leave completed
  // trades' collateral charged and never refunded.
  if (event === 'BOTH_ACCEPTED') {
    await voidTradeHolds(tradeId);
    // A trade including a cash component settles it now that both sides have
    // accepted: the cash leg is a real transfer, not merely a persisted number.
    if ((write.trade.cash_amount_cents ?? 0) > 0) {
      await settleTradeCash(write.trade);
    }
  }

  return { ok: true, state: result.trade.state, transitioned: true };
}

/**
 * Void every ACTIVE Pre_Auth_Hold on a completed Trade (Req 6.7). Best-effort:
 * a void failure here does not roll back COMPLETED (the goods have already
 * changed hands per both Traders' own acceptance) but is logged so it can be
 * investigated — the same tolerance the dispute/fraud paths already apply to
 * their own void calls.
 */
async function voidTradeHolds(tradeId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: holds } = await admin
    .from('pre_auth_holds')
    .select('hold_ref, status')
    .eq('trade_id', tradeId);
  const payments = getPaymentService();
  for (const hold of holds ?? []) {
    if (hold.status !== 'ACTIVE') continue;
    try {
      const voided = await payments.voidHold(hold.hold_ref as string);
      await admin
        .from('pre_auth_holds')
        .update({ status: voided.status })
        .eq('hold_ref', hold.hold_ref as string);
    } catch (err) {
      console.warn(`[trades] failed to void hold ${hold.hold_ref} on completion:`, err);
    }
  }
}

/** Outcome of attempting to settle a trade's cash leg. */
type SettleTradeCashResult =
  | { ok: true }
  | {
      ok: false;
      error: 'not-ready' | 'transfer-failed';
      detail?: string;
    };

/**
 * Settle a completed Trade's cash leg (Req 5.4b). `cash_direction` identifies
 * the participant who pays. Cash terms may be agreed before the receiver has
 * finished payout setup — settlement then waits and flags the trade for
 * reconciliation until they can take funds (or a participant retries).
 *
 * Failure does not block COMPLETED: the goods have already changed hands on
 * both Traders' acceptance.
 */
async function settleTradeCash(trade: TradeRow): Promise<SettleTradeCashResult> {
  const admin = createAdminClient();
  const payerProfileId =
    trade.cash_direction === 'COUNTERPART_PAYS'
      ? trade.counterpart_id
      : trade.initiator_id;
  const receiverProfileId =
    trade.cash_direction === 'COUNTERPART_PAYS'
      ? trade.initiator_id
      : trade.counterpart_id;

  const [{ data: payer }, receiver] = await Promise.all([
    admin.from('profiles').select('id, payer_id').eq('id', payerProfileId).maybeSingle(),
    createSupabaseMerchantRepository(admin).loadMerchant(receiverProfileId),
  ]);

  const payerId = payer?.payer_id as string | null;
  const merchantRef = receiver?.merchantRef ?? null;

  if (!payerId || !canReceiveFunds(receiver) || !merchantRef) {
    await admin
      .from('trades')
      .update({ manual_reconciliation: true })
      .eq('id', trade.id);
    console.warn(
      `[trades] cash settlement for trade ${trade.id} could not be started: ` +
        'payer or payout account missing.',
    );
    return { ok: false, error: 'not-ready' };
  }

  const payments = getPaymentService();
  try {
    const transfer = await payments.requestTransfer({
      payerId,
      amount: trade.cash_amount_cents,
      ref: `trade-cash:${trade.id}`,
      nonce: `trade-cash:${trade.id}`,
      merchantRef,
    });
    if (transfer.status !== 'SETTLED') {
      await admin.from('trades').update({ manual_reconciliation: true }).eq('id', trade.id);
      console.warn(`[trades] cash settlement for trade ${trade.id} failed to settle.`);
      return { ok: false, error: 'transfer-failed' };
    }
    await admin.from('trades').update({ manual_reconciliation: false }).eq('id', trade.id);
    return { ok: true };
  } catch (err) {
    await admin.from('trades').update({ manual_reconciliation: true }).eq('id', trade.id);
    console.warn(`[trades] cash settlement for trade ${trade.id} threw:`, err);
    return {
      ok: false,
      error: 'transfer-failed',
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

/**
 * Retry settling cash on a completed trade after the receiver finishes payout
 * setup (or after a prior transfer attempt failed).
 */
export async function retrySettleTradeCash(
  tradeId: string,
): Promise<
  | { ok: true }
  | ActionFailure<AuthError | 'not-permitted' | 'not-ready' | 'transfer-failed'>
> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const trade = guard.ctx.trade;
  if (trade.state !== 'COMPLETED' || (trade.cash_amount_cents ?? 0) <= 0) {
    return { ok: false, error: 'not-permitted' };
  }
  if (!trade.manual_reconciliation) {
    return { ok: true };
  }

  const settled = await settleTradeCash(trade);
  if (!settled.ok) {
    return { ok: false, error: settled.error, detail: settled.detail };
  }

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true };
}

/**
 * Record that the caller has shipped their own Item during COLLATERAL_LOCKED;
 * transitions the Trade to IN_TRANSIT once both Traders have shipped (Req 6.1,
 * 6.2, 6.8). For delivery trades, carrier + tracking number are required.
 */
export async function recordShipment(
  tradeId: string,
  shipment?: {
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string | null;
  },
): Promise<LifecycleActionResult> {
  return recordLifecycle(tradeId, 'shipment', shipment);
}

/**
 * Record that the caller has received the Counterpart's Item during IN_TRANSIT;
 * transitions the Trade to INSPECTION once both Traders have received (Req 6.3,
 * 6.4, 6.8).
 */
export async function recordReceipt(tradeId: string): Promise<LifecycleActionResult> {
  return recordLifecycle(tradeId, 'receipt');
}

/**
 * Record that the caller has accepted the Counterpart's Item during INSPECTION;
 * transitions the Trade to COMPLETED once both Traders have accepted (Req 6.5,
 * 6.6, 6.8).
 */
export async function recordAcceptance(tradeId: string): Promise<LifecycleActionResult> {
  return recordLifecycle(tradeId, 'acceptance');
}

// ---------------------------------------------------------------------------
// Condition dispute (Req 7.1, 7.5)
// ---------------------------------------------------------------------------

/** Errors surfaced by the dispute/fraud actions. */
export type DisputeActionError = AuthError | DisputeResolutionError | 'HOLD_NOT_FOUND';

/** Build the dispute/fraud resolution orchestrator wired to the default bindings. */
function buildDisputeOrchestrator() {
  const service = getPaymentService();
  const orchestrator = createDefaultTradeOrchestrator({ payments: service });
  return createDefaultDisputeResolutionOrchestrator({
    orchestrator,
    payments: service,
    kyc: service,
  });
}

/** Result of {@link raiseDispute}. */
export type RaiseDisputeActionResult =
  | {
      ok: true;
      state: TradeState;
      disputedAgainst: string;
      frictionTaxSettled: boolean;
      allocation?: FrictionTaxAllocation;
    }
  | ActionFailure<DisputeActionError>;

/**
 * Raise a Condition_Dispute for the Trade during INSPECTION (Req 7.1). The
 * caller is the raising Trader; the disputed-against Trader (their Counterpart),
 * the DISPUTED transition, and the $20 Friction_Tax partial capture are handled
 * by the dispute orchestrator.
 */
export async function raiseDispute(tradeId: string): Promise<RaiseDisputeActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const result = await buildDisputeOrchestrator().raiseConditionDispute({
    tradeId,
    actorId: guard.ctx.userId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return {
    ok: true,
    state: result.trade.state,
    disputedAgainst: result.disputedAgainst,
    frictionTaxSettled: result.frictionTaxSettled,
    allocation: result.allocation,
  };
}

/** Result of {@link resolveDispute}. */
export type ResolveDisputeActionResult =
  | { ok: true; state: TradeState; voidedHoldRefs: string[] }
  | ActionFailure<DisputeActionError>;

/**
 * Resolve a Condition_Dispute when the disputed Item has been returned (Req 7.5):
 * transitions DISPUTED -> COMPLETED and voids the remaining locked holds.
 */
export async function resolveDispute(tradeId: string): Promise<ResolveDisputeActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const result = await buildDisputeOrchestrator().resolveConditionDispute({
    tradeId,
    actorId: guard.ctx.userId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return { ok: true, state: result.trade.state, voidedHoldRefs: result.voidedHoldRefs };
}

// ---------------------------------------------------------------------------
// Objective fraud (Req 8.1)
// ---------------------------------------------------------------------------

/** Result of {@link reportFraud}. */
export type ReportFraudActionResult =
  | { ok: true; state: TradeState; outcome: FraudResolutionOutcome }
  | ActionFailure<DisputeActionError>;

/**
 * Report Objective_Fraud for the Trade from INSPECTION or DISPUTED (Req 8.1).
 * The caller is the victim; the offending Trader is their Counterpart. The
 * FRAUD_RESOLVED transition, full capture, victim payout/void, and evidence-pack
 * generation are handled by the dispute/fraud orchestrator.
 */
export async function reportFraud(tradeId: string): Promise<ReportFraudActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const result = await buildDisputeOrchestrator().reportObjectiveFraud({
    tradeId,
    actorId: guard.ctx.userId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return { ok: true, state: result.outcome.trade.state, outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Evidence pack download (Req 8.4)
// ---------------------------------------------------------------------------

/** Result of {@link downloadEvidencePack}. */
export type DownloadEvidencePackActionResult =
  | { ok: true; storagePath: string; signedUrl: string | null; complete: boolean }
  | ActionFailure<AuthError | 'no-evidence-pack'>;

/**
 * Return the Police_Evidence_Pack storage path and a short-lived signed download
 * URL for a participating Trader (Req 8.4). The signed URL is minted with the
 * service-role client because the evidence-pack bucket is not publicly readable.
 */
export async function downloadEvidencePack(
  tradeId: string,
): Promise<DownloadEvidencePackActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const { trade } = guard.ctx;
  if (!trade.evidence_pack_path) {
    return { ok: false, error: 'no-evidence-pack' };
  }

  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(EVIDENCE_PACK_BUCKET)
    .createSignedUrl(trade.evidence_pack_path, 60 * 60);

  return {
    ok: true,
    storagePath: trade.evidence_pack_path,
    signedUrl: data?.signedUrl ?? null,
    complete: trade.evidence_pack_complete === true,
  };
}

// ---------------------------------------------------------------------------
// updateTradeHandoverTerms — edit face-to-face / postage until first ship
// ---------------------------------------------------------------------------

export type UpdateTradeHandoverTermsError =
  | AuthError
  | 'invalid-state'
  | 'invalid-handover'
  | 'invalid-delivery-cost'
  | 'missing-meeting-location'
  | 'persistence-error';

export type UpdateTradeHandoverTermsResult =
  | { ok: true }
  | ActionFailure<UpdateTradeHandoverTermsError>;

/**
 * Update delivery / meeting terms on a live trade.
 *
 * Either participant may edit while the trade is still in COLLATERAL_PENDING or
 * COLLATERAL_LOCKED and neither side has marked shipped. After shipping starts,
 * terms are frozen.
 */
export async function updateTradeHandoverTerms(
  tradeId: string,
  input: {
    method: HandoverMethod;
    meetingLocation?: string | null;
    meetingLat?: number | null;
    meetingLng?: number | null;
    meetingPlaceId?: string | null;
    meetingAt?: string | null;
    deliveryCostCents?: number | null;
    deliveryNotes?: string | null;
  },
): Promise<UpdateTradeHandoverTermsResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const { trade } = guard.ctx;
  if (
    (trade.state !== 'COLLATERAL_PENDING' && trade.state !== 'COLLATERAL_LOCKED') ||
    trade.initiator_shipped_at != null ||
    trade.counterpart_shipped_at != null
  ) {
    return { ok: false, error: 'invalid-state' };
  }

  if (input.method !== 'IN_PERSON' && input.method !== 'DELIVERY') {
    return { ok: false, error: 'invalid-handover' };
  }

  if (input.method === 'IN_PERSON') {
    if (!input.meetingLocation?.trim()) {
      return { ok: false, error: 'missing-meeting-location' };
    }
  } else {
    const cost = Math.trunc(input.deliveryCostCents ?? NaN);
    if (!Number.isFinite(cost) || cost < 0 || cost > DEAL_DELIVERY_COST_MAX) {
      return { ok: false, error: 'invalid-delivery-cost' };
    }
  }

  const meetingAtRaw = input.meetingAt?.trim() || null;
  const meetingAt =
    meetingAtRaw && !meetingAtRaw.includes('Z') && !meetingAtRaw.includes('+')
      ? new Date(meetingAtRaw).toISOString()
      : meetingAtRaw;

  const columns = toHandoverColumns({
    handoverMethod: input.method,
    meetingLocation: input.meetingLocation,
    meetingLat: input.meetingLat,
    meetingLng: input.meetingLng,
    meetingPlaceId: input.meetingPlaceId,
    meetingAt,
    deliveryCostCents: input.deliveryCostCents,
    deliveryNotes: input.deliveryNotes,
  });

  if (!areHandoverTermsComplete(columns)) {
    return { ok: false, error: 'invalid-handover' };
  }

  // Participant confirmed above; writes on `trades` go through service-role
  // because end-user UPDATE is not granted (same pattern as lifecycle actions).
  const admin = createAdminClient();
  const { error } = await admin
    .from('trades')
    .update({
      ...columns,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId);
  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true };
}
