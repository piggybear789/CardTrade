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
} from '@/domain/orchestrator/supabaseDisputeResolutionRepository';
import type {
  DisputeResolutionError,
  FraudResolutionOutcome,
  FrictionTaxAllocation,
} from '@/domain/orchestrator/disputeResolution';
import type { OrchestratorError } from '@/domain/orchestrator/tradeOrchestrator';
import type { ProposeTradeError } from '@/domain/orchestrator/tradeProposal';
import { getPaymentService, isLivePaymentsProvider } from '@/domain/services';
import { regionForProfile, regionForTrade } from '@/lib/regionBinding';
import { identityGateMessage, readIdentityGate } from '@/lib/identityGate';
import { createSupabaseTradeProposalRepository } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { currentHoldsAreActive, currentHoldsSeekFailed } from '@/domain/orchestrator/tradeProposal';
import {
  LIFECYCLE_SPECS,
  factsFromTrade,
  hasRecorded,
  recordLifecycleTimestamp,
  roleForUser,
  type LifecycleAction,
  type TradeRow,
} from './tradeLifecycleStore';
import { toHandoverColumns, type HandoverMethod } from '@/lib/handover/terms';
import {
  MAX_MEETING_LEAD_HOURS,
  TRADE_HANDOVER_METHODS,
  validateFulfilmentTerms,
  type DeliveryAddress,
  type FulfilmentTermsError,
} from '@/domain/fulfilment';
import { getTrackingService } from '@/domain/services/tracking';
import { finalizeCompletedTrade, settleTradeCash } from '@/lib/trades/completion';
import {
  DEAL_DELIVERY_COST_MAX,
  DISPUTE_REASON_MAX,
  DISPUTE_REASON_MIN,
} from '@/lib/marketplace-constants';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import { revalidatePath } from 'next/cache';
import { createNotification } from '@/lib/notifications/createNotification';
import { emailNotify } from '@/lib/email';

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
  },
): Promise<ProposeTradeActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // THE PROPOSER IS THE CALLER. FULL STOP.
  //
  // This used to accept an `onBehalfOfUserId` option and use it as the proposer,
  // for `acceptTradeProposal` — which was removed in 0055 and has no replacement.
  // Its own doc-comment said the value "must never be threaded through from client
  // input", but every export of a `'use server'` module IS client input: the option
  // was settable by anyone who could call the action.
  //
  // The effect was that a verified member could pass two ids straight off the public
  // catalog and force two OTHER members into trade escrow — creating a trade neither
  // had proposed, reserving both items, and placing a real card authorisation for
  // 100% of FMV on both of their saved cards, with the caller not a party to it. It
  // also skipped the region-compatibility and shopfront guards that
  // `openTradeNegotiation` applies.
  const initiatorId = user.id;

  // Req 14.2. Entering trade escrow requires the Identity_Gate, because an
  // Objective_Fraud resolution pays captured collateral to whichever trader was
  // the victim — either side can RECEIVE money here. A Member with no payout
  // account could be awarded restitution the platform has no way to deliver, so
  // the trade must not start.
  //
  // BOTH parties are checked, not just the caller — a fraud finding can pay either
  // side, so both must be able to receive. The loop this replaces walked the caller
  // and the removed `onBehalfOfUserId` proposer, which after that removal were always
  // the same person: it checked one party twice and the actual counterparty never.
  // The counterparty is now resolved from the item being traded for.
  const { data: targetItem } = await supabase
    .from('items')
    .select('owner_id, listing_kind')
    .eq('id', counterpartItemId)
    .maybeSingle();
  if (!targetItem) return { ok: false, error: 'item-not-found' };

  // A binder can be traded FOR since 0081, but only through `openTradeNegotiation`,
  // which collects the statement of which cards come out of it. This path creates the
  // trade, reserves the goods and authorises both cards in ONE step, so it has no
  // point at which that statement could be agreed — and a binder trade without it is
  // a contract whose goods are an inventory title, which is precisely what arbitration
  // cannot adjudicate. Refused rather than allowed to create one silently.
  //
  // This module has no UI caller, but every export of a `'use server'` module is an
  // endpoint reachable by anyone who learns its id — see the note above about
  // `onBehalfOfUserId`.
  if ((targetItem.listing_kind as string) === 'SHOPFRONT') {
    return {
      ok: false,
      error: 'item-unavailable',
      detail:
        'This is a binder or bulk listing. Open a trade offer on it so you can say which cards you want.',
    };
  }

  const callerGate = await readIdentityGate(initiatorId);
  if (!callerGate.satisfied) {
    // This module's ActionFailure carries `detail`, not `message`.
    return {
      ok: false,
      error: 'not-verified',
      detail: identityGateMessage('trade', callerGate.state),
    };
  }

  const counterpartyId = targetItem.owner_id as string;
  if (counterpartyId !== initiatorId) {
    const counterpartyGate = await readIdentityGate(counterpartyId);
    if (!counterpartyGate.satisfied) {
      return {
        ok: false,
        error: 'not-verified',
        detail: 'The other trader has not verified their identity, so this trade cannot start yet.',
      };
    }
  }

  // Collateral is placed in the same call that creates the trade, so there is no
  // frozen currency to read yet — the region comes from the initiator's profile
  // (0068). Both traders are in one region by then: `openTradeNegotiation` refused
  // the offer otherwise. The holds are real card authorisations on the region's own
  // platform account, and placing them on the wrong one would not find the trader's
  // saved card at all.
  const tradeRegion = await regionForProfile(initiatorId);

  const result = await proposeTradeWithSupabase(getPaymentService(tradeRegion), {
    proposerId: initiatorId,
    initiatorItemId,
    initiatorExtraItemIds: options?.initiatorExtraItemIds ?? [],
    counterpartItemId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };

  if (result.bondsRequired === 0) {
    // No collateral to wait on: lock the trade now. A rejected transition is not
    // fatal — the Trade still exists in COLLATERAL_PENDING and can be retried.
    const orchestrator = createDefaultTradeOrchestrator({
      payments: getPaymentService(tradeRegion),
    });
    await orchestrator.applyEvent({
      tradeId: result.trade.id,
      event: 'HOLDS_CONFIRMED',
      actorId: initiatorId,
    });
  } else if (isLivePaymentsProvider()) {
    // Stripe realtime charges return synchronously. Advance the trade from the
    // hold rows instead of waiting for a webhook (or the mock DemoPanel).
    await syncTradeHoldsFromStripe(result.trade.id, initiatorId);
  }

  return { ok: true, tradeId: result.trade.id };
}

/**
 * After Stripe `POST /payments/realtime`, hold rows already reflect ACTIVE/FAILED.
 * Drive HOLDS_CONFIRMED / HOLDS_FAILED from that truth so trades leave
 * COLLATERAL_PENDING without a fake webhook button.
 */
async function syncTradeHoldsFromStripe(tradeId: string, actorId: string): Promise<void> {
  const admin = createAdminClient();
  const repository = createSupabaseTradeProposalRepository(admin);
  const holds = await repository.getHolds(tradeId);
  if (holds.length === 0) return;

  // HOLDS_FAILED runs the documented compensation, which VOIDS the holds that did
  // succeed — a provider call, so this needs the trade's own platform account (0068).
  const orchestrator = createDefaultTradeOrchestrator({
    payments: getPaymentService(await regionForTrade(tradeId)),
  });
  if (currentHoldsAreActive(holds)) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
    return;
  }
  if (currentHoldsSeekFailed(holds)) {
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

/** Map a lifecycle action to its notification content (title + body + link). */
function lifecycleNotification(
  action: LifecycleAction,
  tradeId: string,
): { title: string; body: string; link: string } | null {
  switch (action) {
    case 'shipment':
      return {
        title: 'Your trade partner shipped',
        body: 'They marked their parcel as sent. Watch for delivery.',
        link: `/trades/${tradeId}`,
      };
    case 'receipt':
      return {
        title: 'Your parcel was received',
        body: 'The other trader confirmed your parcel arrived.',
        link: `/trades/${tradeId}`,
      };
    case 'acceptance':
      return {
        title: 'Inspection passed',
        body: 'The other trader approved what they received.',
        link: `/trades/${tradeId}`,
      };
    case 'handover':
      return {
        title: 'Handover confirmed',
        body: 'The other trader confirmed the in-person exchange.',
        link: `/trades/${tradeId}`,
      };
    default:
      return null;
  }
}

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

  // Action must be permitted in the current state (Req 6.8). Read from the same
  // table the guarded write uses, so there is one answer to "when may this happen".
  if (trade.state !== LIFECYCLE_SPECS[action].requiredState) {
    return { ok: false, error: 'not-permitted' };
  }

  // ...and must match the agreed fulfilment method. `shipment` and `handover` are
  // the two ways goods leave your hands, recorded in the same state; offering both
  // is what let a face-to-face trade be walked through a shipping lifecycle.
  const inPerson = trade.handover_method === 'IN_PERSON';
  if (action === 'shipment' && inPerson) {
    return {
      ok: false,
      error: 'not-permitted',
      detail: 'This trade is face to face. Confirm the handover instead of recording a shipment.',
    };
  }
  if (action === 'handover' && !inPerson) {
    return {
      ok: false,
      error: 'not-permitted',
      detail: 'This trade is posted. Record a shipment instead of confirming a handover.',
    };
  }

  // Once-only per trader (Req 6.1/6.3/6.5, 6.8).
  if (hasRecorded(trade, action, role)) {
    return { ok: false, error: 'already-recorded' };
  }

  let extra: TablesUpdate<'trades'> | undefined;
  if (action === 'shipment') {
    const carrier = shipment?.carrier?.trim() ?? '';
    const trackingNumber = shipment?.trackingNumber?.trim() ?? '';
    if (!carrier || trackingNumber.length < 2) {
      return {
        ok: false,
        error: 'not-permitted',
        detail: 'Carrier and tracking number are required for a posted trade.',
      };
    }
    extra = trackingColumnsFor(role, {
      carrier,
      trackingNumber,
      trackingUrl: shipment?.trackingUrl?.trim() || null,
    });
  }

  // Persist the caller's own timestamp; the guarded write also enforces
  // once-only + state under concurrency.
  const write = await recordLifecycleTimestamp({ tradeId, action, role, extra });
  if (!write.recorded) {
    return { ok: false, error: 'already-recorded' };
  }

  // A posted trade registers each parcel with the tracking provider as it is
  // recorded, so a later carrier confirmation has something to update. Failure is
  // tolerated: the shipment is already recorded and the trade must not stall on a
  // carrier lookup.
  if (action === 'shipment' && shipment) {
    await registerTradeShipment(tradeId, role, shipment).catch((err) => {
      console.warn(`[trades] tracking registration failed for ${tradeId}:`, err);
    });
  }

  // Derive the aggregate event from the freshly updated row. When only one side
  // has acted, there is no transition yet — the recording itself is the result.
  const event = deriveEvent(write.trade.state, factsFromTrade(write.trade));
  if (!event) {
    revalidatePath(`/trades/${tradeId}`);

    // Best-effort notification to the counterpart.
    const recipientId = trade.initiator_id === userId
      ? trade.counterpart_id as string
      : trade.initiator_id as string;
    const note = lifecycleNotification(action, tradeId);
    if (note) {
      await createNotification({ userId: recipientId, type: 'TRADE', ...note });
    }
    if (action === 'shipment') {
      void emailNotify.itemShipped({
        userId: recipientId,
        contractType: 'trade',
        contractId: tradeId,
      });
    }

    return { ok: true, state: write.trade.state, transitioned: false };
  }

  // Bound to the trade's own platform account (0068): transitions out of escrow void
  // or capture real authorisations, and those belong to one Stripe account.
  const orchestrator = createDefaultTradeOrchestrator({
    payments: getPaymentService(await regionForTrade(tradeId)),
  });
  const result = await orchestrator.applyEvent({ tradeId, event, actorId: userId });
  if (!result.ok) {
    return { ok: false, error: result.error, detail: result.detail };
  }

  if (event === 'BOTH_ACCEPTED') {
    await finalizeCompletedTrade(write.trade);
  }

  revalidatePath(`/trades/${tradeId}`);

  // Best-effort notification to the counterpart.
  const recipientId = trade.initiator_id === userId
    ? trade.counterpart_id as string
    : trade.initiator_id as string;
  const note = lifecycleNotification(action, tradeId);
  if (note) {
    await createNotification({ userId: recipientId, type: 'TRADE', ...note });
  }
  if (action === 'shipment') {
    void emailNotify.itemShipped({
      userId: recipientId,
      contractType: 'trade',
      contractId: tradeId,
    });
  }

  return { ok: true, state: result.trade.state, transitioned: true };
}

/** Per-role tracking columns for one trader's outbound parcel. */
function trackingColumnsFor(
  role: TradeViewerRole,
  shipment: { carrier: string; trackingNumber: string; trackingUrl: string | null },
): TablesUpdate<'trades'> {
  return role === 'INITIATOR'
    ? {
        initiator_tracking_carrier: shipment.carrier,
        initiator_tracking_number: shipment.trackingNumber,
        initiator_tracking_url: shipment.trackingUrl,
      }
    : {
        counterpart_tracking_carrier: shipment.carrier,
        counterpart_tracking_number: shipment.trackingNumber,
        counterpart_tracking_url: shipment.trackingUrl,
      };
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

/**
 * Errors surfaced by the dispute/fraud actions.
 *
 * `VALIDATION_ERROR` is the action layer's own, not the orchestrator's: a claim that is
 * too short never reaches the domain, because the domain's job is deciding a dispute
 * rather than checking a text length.
 */
export type DisputeActionError =
  | AuthError
  | DisputeResolutionError
  | 'HOLD_NOT_FOUND'
  | 'VALIDATION_ERROR';

/**
 * Build the dispute/fraud resolution orchestrator for one trade.
 *
 * Takes a region because resolution CAPTURES collateral — a Friction_Tax partial
 * capture, or a full capture paid to a fraud victim — and an authorisation belongs to
 * the Stripe platform account that created it (0068). Resolving through another
 * region's client would fail to find the PaymentIntent, leaving a determined dispute
 * with no money moved.
 */
function buildDisputeOrchestrator(region: string) {
  const service = getPaymentService(region);
  const orchestrator = createDefaultTradeOrchestrator({ payments: service });
  return createDefaultDisputeResolutionOrchestrator({
    orchestrator,
    payments: service,
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
 *
 * `reason` is the raiser's own account of what went wrong (0083), and reaches the
 * arbitration case as "the claim". It is required for the same reason the Cash_Sale
 * equivalent requires one: a dispute that captures money from the other trader and can
 * end in a full collateral capture must say what it is about.
 */
export async function raiseDispute(
  tradeId: string,
  reason: string,
): Promise<RaiseDisputeActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const trimmed = reason.trim();
  if (trimmed.length < DISPUTE_REASON_MIN) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      detail: `Describe the problem in at least ${DISPUTE_REASON_MIN} characters.`,
    };
  }
  if (trimmed.length > DISPUTE_REASON_MAX) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      detail: `Keep it under ${DISPUTE_REASON_MAX} characters.`,
    };
  }

  const result = await buildDisputeOrchestrator(await regionForTrade(tradeId)).raiseConditionDispute({
    tradeId,
    actorId: guard.ctx.userId,
    reason: trimmed,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };

  // Best-effort notification to the counterpart.
  const recipientId = guard.ctx.trade.initiator_id === guard.ctx.userId
    ? guard.ctx.trade.counterpart_id as string
    : guard.ctx.trade.initiator_id as string;
  await createNotification({
    userId: recipientId,
    type: 'TRADE',
    title: 'Dispute raised',
    body: 'A dispute has been filed on your trade. Please respond with your account.',
    link: `/trades/${tradeId}`,
  });
  void emailNotify.disputeRaised({
    userId: recipientId,
    contractType: 'trade',
    contractId: tradeId,
  });

  return {
    ok: true,
    state: result.trade.state,
    disputedAgainst: result.disputedAgainst,
    frictionTaxSettled: result.frictionTaxSettled,
    allocation: result.allocation,
  };
}

// `resolveDispute` was removed from the participant surface, and its result type with
// it — a type describing the shape of a call nobody can make is only a hint that the
// call should come back.
//
// It was gated on `requireParticipant` and captured the $20 Friction_Tax from the
// OTHER trader, so either party could trigger a capture against the other. Nothing
// in the UI called it, but an exported Server Action is reachable by anyone who
// knows its id, so an unused one is still an attack surface rather than dead code.
//
// Resolution is now `resolveTradeConditionDispute` in `lib/actions/admin.ts`,
// admin-gated. Participants raise a dispute (`raiseDispute`) or claim fraud
// (`reportFraud`); an operator decides.

// ---------------------------------------------------------------------------
// Objective fraud (Req 8.1)
// ---------------------------------------------------------------------------

/** Result of {@link reportFraud}. */
export type ReportFraudActionResult =
  | { ok: true; state: TradeState; outcome: FraudResolutionOutcome }
  | ActionFailure<DisputeActionError>;

/** Result of {@link reportFraud}. */
export type ClaimFraudActionResult =
  | { ok: true; state: TradeState }
  | ActionFailure<DisputeActionError>;

/**
 * CLAIM Objective_Fraud on a Trade from INSPECTION or DISPUTED (Req 8.1, revised).
 *
 * Records an allegation and moves the Trade to DISPUTED. It deliberately captures
 * NOTHING and pays NOTHING.
 *
 * This function used to do the whole thing: it treated its caller as the victim,
 * transitioned straight to the terminal FRAUD_RESOLVED, full-captured the
 * counterparty's 100%-of-FMV collateral, transferred it to the caller, and voided
 * the caller's own hold. Gated only on being a participant, that meant either
 * trader could take the other's money by clicking first — no evidence, no review,
 * no chance for the accused to answer.
 *
 * Determining fraud and moving collateral is now
 * {@link resolveTradeFraud} in `lib/actions/admin.ts`, which is admin-gated and
 * requires the operator to name the victim explicitly.
 */
export async function reportFraud(
  tradeId: string,
  reason: string,
): Promise<ClaimFraudActionResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;

  const trimmed = reason.trim();
  if (trimmed.length < DISPUTE_REASON_MIN) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      detail: `Describe what happened in at least ${DISPUTE_REASON_MIN} characters.`,
    };
  }
  if (trimmed.length > DISPUTE_REASON_MAX) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      detail: `Keep it under ${DISPUTE_REASON_MAX} characters.`,
    };
  }

  // Move to DISPUTED first, so the Trade is visibly frozen and an operator can see
  // it. Already-disputed trades are fine: `raiseConditionDispute` is a no-op
  // transition from DISPUTED, and the claim below records regardless.
  const raised = await buildDisputeOrchestrator(await regionForTrade(tradeId)).raiseConditionDispute({
    tradeId,
    actorId: guard.ctx.userId,
    reason: trimmed,
  });

  const admin = createAdminClient();
  const { data: recorded } = await admin.rpc('record_trade_fraud_claim', {
    p_trade_id: tradeId,
    p_claimant_id: guard.ctx.userId,
    // The claimant's OWN words (0083). This used to be the literal string 'Objective
    // fraud reported by a trader', which told an arbitrator only that the button had
    // been pressed — on the one claim that can capture a trader's full collateral.
    p_reason: trimmed,
  });

  // Only a genuine failure if BOTH the transition and the claim were rejected. An
  // already-DISPUTED trade legitimately fails the transition while the claim records.
  if (!recorded && !raised.ok) {
    return { ok: false, error: raised.error, detail: raised.detail };
  }

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, state: raised.ok ? raised.trade.state : 'DISPUTED' };
}

// NOTE: `downloadEvidencePack` has been removed.
//
// It minted a signed URL to a PDF containing the OTHER party's legal name, date
// of birth and government document number, gated only on being a participant in
// the trade. A victim could therefore obtain the accused's identity documents on
// the strength of an in-app fraud determination, with no court order and no
// appeal. The platform no longer reads verified identity fields at all.

// ---------------------------------------------------------------------------
// updateTradeHandoverTerms — edit face-to-face / postage until first ship
// ---------------------------------------------------------------------------

export type UpdateTradeHandoverTermsError =
  | AuthError
  | 'invalid-state'
  | 'invalid-handover'
  | 'invalid-delivery-cost'
  | 'missing-meeting-location'
  | 'missing-meeting-time'
  | 'persistence-error';

export type UpdateTradeHandoverTermsResult =
  | { ok: true }
  | ActionFailure<UpdateTradeHandoverTermsError>;

/**
 * Update meeting terms on a live trade — which is also how a meeting is rescheduled.
 *
 * EDITABLE ONLY UNTIL THE COLLATERAL IS PLACED. `COLLATERAL_LOCKED` used to be
 * editable too, and under the old model that was harmless: the hold went on the moment
 * terms were agreed, so it was not tied to any particular date. Now it is placed a day
 * before the MEETING, so moving the date afterwards would leave a live authorisation
 * pointed at a date nobody is turning up on — and expiring during an inspection window
 * it no longer covers.
 *
 * The practical rule that gives a trader is "reschedule freely until the day before",
 * which is when the sweep authorises the cards. After that the date is fixed and a
 * change means cancelling and re-agreeing, which re-runs the placement from scratch
 * rather than trying to move an authorisation that cannot be moved.
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
  if (trade.state !== 'NEGOTIATING' && trade.state !== 'COLLATERAL_PENDING') {
    return { ok: false, error: 'invalid-state' };
  }

  const meetingAtRaw = input.meetingAt?.trim() || null;
  const meetingAt =
    meetingAtRaw && !meetingAtRaw.includes('Z') && !meetingAtRaw.includes('+')
      ? new Date(meetingAtRaw).toISOString()
      : meetingAtRaw;

  // One validator, shared with the Cash_Sale and with the negotiation counter. A
  // meeting TIME is now required where it used to be optional: the inspection
  // window of a face-to-face trade is measured from the meeting instant, so an
  // absent one leaves the trade with no clock and its collateral racing the card
  // authorisation with nothing to stop it.
  const validation = validateFulfilmentTerms(
    {
      method: input.method,
      meeting: {
        place: input.meetingLocation?.trim()
          ? {
              label: input.meetingLocation.trim(),
              placeId: input.meetingPlaceId ?? '',
              lat: input.meetingLat ?? Number.NaN,
              lng: input.meetingLng ?? Number.NaN,
            }
          : null,
        at: meetingAt,
      },
      delivery: {
        costCents: input.deliveryCostCents ?? null,
        notes: input.deliveryNotes ?? null,
      },
    },
    {
      maxDeliveryCostCents: DEAL_DELIVERY_COST_MAX,
      // Trades are face-to-face only. Collateral is a card authorisation with a
      // deadline, and postage in both directions cannot be made to fit inside it.
      allowedMethods: TRADE_HANDOVER_METHODS,
      maxMeetingLeadHours: MAX_MEETING_LEAD_HOURS,
    },
  );
  if (!validation.ok) {
    return { ok: false, error: termsErrorFor(validation.error) };
  }

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

/** Map a shared fulfilment validation failure onto this module's error surface. */
function termsErrorFor(
  error: FulfilmentTermsError,
): UpdateTradeHandoverTermsError {
  switch (error) {
    case 'meeting-place-required':
    case 'meeting-place-unresolved':
      return 'missing-meeting-location';
    case 'meeting-time-required':
    case 'meeting-time-past':
    case 'meeting-time-too-far':
      return 'missing-meeting-time';
    case 'method-not-supported':
      return 'invalid-handover';
    case 'delivery-cost-required':
    case 'delivery-cost-invalid':
      return 'invalid-delivery-cost';
    default:
      return 'invalid-handover';
  }
}

// ---------------------------------------------------------------------------
// Face-to-face handover (0057)
// ---------------------------------------------------------------------------

/**
 * Confirm that the face-to-face exchange happened.
 *
 * Recorded once per trader in COLLATERAL_LOCKED. The second confirmation moves the
 * trade to INSPECTION — NOT to COMPLETED, which is where this deliberately differs
 * from the Cash_Sale's in-person path. A trader who has just been robbed, coerced,
 * or handed a convincing fake at a meeting point must not be able to sign the trade
 * off on the spot. Confirming a handover says "we met and swapped"; accepting the
 * item afterwards says "I am satisfied", and only that releases the collateral.
 */
export async function confirmTradeHandover(
  tradeId: string,
): Promise<LifecycleActionResult> {
  return recordLifecycle(tradeId, 'handover');
}

/** Errors surfaced by {@link reportTradeHandoverFailed}. */
export type HandoverFailedError =
  | AuthError
  | 'not-permitted'
  | 'invalid-reason'
  | OrchestratorError;

/** Result of {@link reportTradeHandoverFailed}. */
export type HandoverFailedResult =
  | { ok: true; state: TradeState }
  | ActionFailure<HandoverFailedError>;

/**
 * Report that the exchange did not happen, and freeze the trade for review.
 *
 * Reachable from COLLATERAL_LOCKED (a no-show, a refusal at the meeting point, an
 * exchange under duress) and from IN_TRANSIT (a parcel that never arrived). Before
 * this existed, an IN_TRANSIT trade had NO exit at all: both traders' collateral sat
 * there until the card authorisation lapsed, which removes the guarantee rather than
 * resolving anything.
 *
 * Captures NOTHING. This is why it is not `raiseDispute`, which settles a $20
 * Friction_Tax against the other trader — at this point neither side has necessarily
 * done anything wrong, and a lost parcel is nobody's fault.
 */
export async function reportTradeHandoverFailed(
  tradeId: string,
  reason: string,
): Promise<HandoverFailedResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;
  const { userId, trade } = guard.ctx;

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 10 || trimmed.length > 2000) {
    return {
      ok: false,
      error: 'invalid-reason',
      detail: 'Describe what happened in at least a sentence.',
    };
  }
  if (trade.state !== 'COLLATERAL_LOCKED' && trade.state !== 'IN_TRANSIT') {
    return { ok: false, error: 'not-permitted' };
  }

  const orchestrator = createDefaultTradeOrchestrator({
    payments: getPaymentService(await regionForTrade(tradeId)),
  });
  const result = await orchestrator.applyEvent({
    tradeId,
    event: 'HANDOVER_FAILED',
    actorId: userId,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };

  // Record who froze it and why, so an operator opens the case with the account.
  // Deliberately not `disputed_against`: nobody has been accused of anything.
  const admin = createAdminClient();
  await admin
    .from('trades')
    .update({
      dispute_raised_by: userId,
      disputed_at: new Date().toISOString(),
      cancel_reason: trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId);

  revalidatePath(`/trades/${tradeId}`);

  // Best-effort notification to the counterpart.
  const recipientId = trade.initiator_id === userId
    ? trade.counterpart_id as string
    : trade.initiator_id as string;
  await createNotification({
    userId: recipientId,
    type: 'TRADE',
    title: 'Problem reported',
    body: 'The other trader reported a problem with the exchange.',
    link: `/trades/${tradeId}`,
  });

  return { ok: true, state: result.trade.state };
}

// ---------------------------------------------------------------------------
// Postal addresses (0057)
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link saveTradeDeliveryAddress}. */
export type TradeAddressError =
  | AuthError
  | 'invalid-state'
  | 'invalid-address'
  | 'persistence-error';

/** Result of {@link saveTradeDeliveryAddress}. */
export type TradeAddressResult = { ok: true } | ActionFailure<TradeAddressError>;

/**
 * Save the caller's own postal address for a posted trade.
 *
 * A trade posts in BOTH directions, so each trader supplies their own and reads the
 * other's — the Cash_Sale has one address because only the Buyer receives goods.
 * The address is written to `trade_delivery_details`, which is NOT in the Realtime
 * publication, and the counterpart can only read it from COLLATERAL_LOCKED onward.
 * Before this, traders exchanged postal addresses in the chat thread.
 *
 * Only provider-resolved addresses are accepted. A typed string cannot be posted to
 * with any confidence and cannot be checked against what the other party thought
 * they agreed.
 */
export async function saveTradeDeliveryAddress(
  tradeId: string,
  address: DeliveryAddress,
): Promise<TradeAddressResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;
  const { userId, trade } = guard.ctx;

  if (
    trade.state !== 'NEGOTIATING' &&
    trade.state !== 'COLLATERAL_PENDING' &&
    trade.state !== 'COLLATERAL_LOCKED'
  ) {
    return { ok: false, error: 'invalid-state' };
  }

  const validation = validateFulfilmentTerms(
    {
      method: 'DELIVERY',
      meeting: { place: null, at: null },
      // Cost is not being changed here; borrow a valid one so the shared validator
      // only judges the address.
      delivery: { costCents: trade.delivery_cost_cents ?? 0, notes: null },
    },
    { requireDeliveryAddress: true, deliveryAddress: address },
  );
  if (!validation.ok) {
    return {
      ok: false,
      error: 'invalid-address',
      detail: 'Choose an address from the suggestions.',
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('set_trade_delivery_address', {
    p_trade_id: tradeId,
    p_trader_id: userId,
    p_address_label: address.label.trim(),
    p_place_id: address.placeId,
    p_country_code: address.countryCode || null,
    p_latitude: address.lat,
    p_longitude: address.lng,
  });
  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return { ok: false, error: 'invalid-state' };
  }

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true };
}

/** One trader's address as the room needs to render it. */
export interface TradeAddressView {
  /** `'mine'` is always readable; `'theirs'` only from COLLATERAL_LOCKED. */
  mine: DeliveryAddress | null;
  theirs: DeliveryAddress | null;
}

/**
 * Read the addresses the caller is entitled to see.
 *
 * Deliberately goes through the COOKIE-BOUND client so RLS decides what comes back,
 * rather than the service role plus a hand-written check. The policy in 0057 is the
 * authority on disclosure, and a second implementation here could only disagree
 * with it.
 */
export async function getTradeDeliveryAddresses(
  tradeId: string,
): Promise<TradeAddressView> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { mine: null, theirs: null };

  const { data } = await supabase
    .from('trade_delivery_details')
    .select('trader_id, address_label, place_id, country_code, latitude, longitude')
    .eq('trade_id', tradeId);

  const view: TradeAddressView = { mine: null, theirs: null };
  for (const row of data ?? []) {
    const address: DeliveryAddress = {
      label: row.address_label,
      placeId: row.place_id,
      countryCode: row.country_code,
      lat: row.latitude,
      lng: row.longitude,
    };
    if (row.trader_id === user.id) view.mine = address;
    else view.theirs = address;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Carrier tracking (0057)
// ---------------------------------------------------------------------------

/**
 * Register one trader's parcel with the tracking provider.
 *
 * Best-effort and fire-and-forget from the caller's point of view: a shipment is
 * already recorded by the time this runs, and the trade must not stall on a carrier
 * lookup. The manual provider simply normalises the number.
 */
async function registerTradeShipment(
  tradeId: string,
  role: TradeViewerRole,
  shipment: { carrier: string; trackingNumber: string },
): Promise<void> {
  const tracking = getTrackingService();
  const snapshot = await tracking.registerShipment({
    carrier: shipment.carrier.trim(),
    trackingNumber: shipment.trackingNumber.trim(),
  });
  const admin = createAdminClient();
  await admin
    .from('trades')
    .update(
      role === 'INITIATOR'
        ? {
            initiator_tracking_status: snapshot.status,
            initiator_tracking_url: snapshot.trackingUrl,
          }
        : {
            counterpart_tracking_status: snapshot.status,
            counterpart_tracking_url: snapshot.trackingUrl,
          },
    )
    .eq('id', tradeId);
}

/** Result of {@link syncTradeTracking}. */
export type SyncTradeTrackingResult =
  | { ok: true; delivered: boolean; state: TradeState }
  | ActionFailure<AuthError | 'not-permitted' | 'not-supported' | OrchestratorError>;

/**
 * Refresh both parcels from the carrier.
 *
 * A carrier-confirmed delivery is the ONLY thing that sets
 * `*_carrier_delivered_at`, which is in turn what the inspection deadline is
 * measured from. A trader's own assertion that a parcel arrived records receipt but
 * never starts the clock — the same rule the Cash_Sale applies, and for the same
 * reason: the clock can end in a payout, so its start must not be self-reported.
 *
 * Once BOTH parcels are confirmed delivered the trade advances to INSPECTION on the
 * carrier's word alone, so an unresponsive trader cannot hold the exchange open by
 * simply never pressing "received".
 */
export async function syncTradeTracking(
  tradeId: string,
): Promise<SyncTradeTrackingResult> {
  const guard = await requireParticipant(tradeId);
  if (!guard.ok) return guard;
  const { userId, trade } = guard.ctx;

  if (trade.handover_method !== 'DELIVERY') {
    return { ok: false, error: 'not-permitted' };
  }
  const tracking = getTrackingService();
  if (!tracking.fetchStatus) {
    return {
      ok: false,
      error: 'not-supported',
      detail: 'Automated tracking is not configured for this carrier.',
    };
  }

  const admin = createAdminClient();
  const parcels = [
    {
      traderId: trade.initiator_id,
      carrier: trade.initiator_tracking_carrier,
      number: trade.initiator_tracking_number,
    },
    {
      traderId: trade.counterpart_id,
      carrier: trade.counterpart_tracking_carrier,
      number: trade.counterpart_tracking_number,
    },
  ];

  let delivered = false;
  let latest: TradeRow = trade;
  for (const parcel of parcels) {
    if (!parcel.carrier?.trim() || !parcel.number?.trim()) continue;
    const snapshot = await tracking.fetchStatus({
      carrier: parcel.carrier,
      trackingNumber: parcel.number,
    });
    if (!snapshot) continue;
    const { data } = await admin.rpc('apply_trade_tracking', {
      p_trade_id: tradeId,
      p_trader_id: parcel.traderId,
      p_tracking_status: snapshot.status,
      p_delivered_at: snapshot.deliveredAt ?? undefined,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (row) latest = row as TradeRow;
    if (snapshot.status === 'DELIVERED') delivered = true;
  }

  // Both parcels confirmed by the carrier is a complete exchange, whether or not
  // either trader pressed anything.
  if (
    latest.state === 'IN_TRANSIT' &&
    latest.initiator_carrier_delivered_at &&
    latest.counterpart_carrier_delivered_at
  ) {
    const orchestrator = createDefaultTradeOrchestrator({
      payments: getPaymentService(await regionForTrade(tradeId)),
    });
    const result = await orchestrator.applyEvent({
      tradeId,
      event: 'BOTH_RECEIVED',
      actorId: userId,
    });
    if (result.ok) {
      revalidatePath(`/trades/${tradeId}`);
      return { ok: true, delivered, state: result.trade.state };
    }
  }

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, delivered, state: latest.state };
}


