'use server';

// lib/actions/tradeNegotiation.ts
//
// Negotiating a Trade inside its own contract room. A Trade now exists from the
// FIRST offer in state NEGOTIATING, so countering is a versioned terms revision
// on the Trade rather than a chain of replacement `trade_proposals` rows, and the
// conversation spans negotiation, collateral and fulfilment without a seam.
//
// Thin by convention: authenticate, gate on the Identity_Gate where money can be
// received, delegate to one SQL function, revalidate. Every guard is repeated in
// SQL because these calls run as the service role.
//
// The money boundary is deliberate. `begin_trade_collateral` moves the row to
// COLLATERAL_PENDING and reserves the Items; the bonds are then placed by
// `placeBondsForAgreedTrade`, and HOLDS_CONFIRMED / HOLDS_FAILED are dispatched
// exactly as the single-click path does. No SQL function touches a payment.

import { withActionLog } from '@/lib/errors/withActionLog';
import { revalidatePath } from 'next/cache';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { readIdentityGate, identityGateMessage } from '@/lib/identityGate';
import { createNotification } from '@/lib/notifications/createNotification';
import { tradeContext } from '@/lib/notifications/notificationContext';
import { confirmTradeCollateral } from '@/lib/trades/collateralLock';
import { emailNotify } from '@/lib/email';
import { createPrivateTradeItem, type ImageInput } from '@/lib/actions/listings';
import { operationalRegions } from '@/domain/services';
import { currentHoldsSeekFailed } from '@/domain/orchestrator/tradeProposal';
import { currentHoldsCoverTraders } from '@/domain/bond/currentHolds';
import { createSupabaseTradeProposalRepository } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { freezeTradeSideValues, placeTradeCollateral } from '@/lib/trades/collateralPlacement';
import {
  MAX_MEETING_LEAD_HOURS,
  TRADE_HANDOVER_METHODS,
  validateFulfilmentTerms,
} from '@/domain/fulfilment';
import { checkRegionCompatibility, regionMismatchMessage } from '@/domain/region';
import type { Tables } from '@/lib/supabase/database.types';
import { getPaymentService } from '@/domain/services';
import { regionForTrade } from '@/lib/regionBinding';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { membersAreRelated } from '@/lib/risk/signals';
import { RELATED_ACCOUNTS_MESSAGE } from '@/domain/risk/relatedAccounts';
import { contractLimiter } from '@/lib/rateLimiters';
import {
  confirmTradeCashPayment as confirmTradeCashPaymentCore,
  getTradeCashPaymentAction as getTradeCashPaymentActionCore,
  payTradeCash as payTradeCashCore,
  type TradeCashError,
  type TradeCashStatus,
} from '@/domain/orchestrator/tradeCashSettlement';
import {
  createDefaultTradeCashDeps,
  ensureTradeCashSettlement,
} from '@/domain/orchestrator/supabaseTradeCashSettlementRepository';

type TradeRow = Tables<'trades'>;

export type TradeNegotiationError =
  | 'unauthenticated'
  | 'not-verified'
  | 'not-participant'
  | 'not-negotiating'
  | 'not-permitted'
  | 'stale-terms'
  | 'invalid-terms'
  /** No face-to-face meeting place and time on the terms (ESC-04). */
  | 'terms-incomplete'
  | 'rejected'
  | 'bond-failed'
  /** ESC-05: the trade cash payment was declined; nothing was charged. */
  | 'cash-declined'
  /** ESC-05: the deadline to pay the trade cash has passed. */
  | 'trade-cash-pay-by-passed'
  /** ESC-05: a saved card is needed to pay the trade cash. */
  | 'no-payment-method'
  /** ESC-03 layer 3: the two traders are related accounts. Generic copy. */
  | 'related-accounts';

export type TradeNegotiationResult =
  | {
      ok: true;
      trade: TradeRow;
      collateralStarted: boolean;
      /**
       * ESC-05: the viewer is the trader who pays the cash leg, and it is unpaid.
       * The room opens the pay step straight away.
       */
      nextAction?: { kind: 'PAY_TRADE_CASH' };
    }
  | { ok: false; error: TradeNegotiationError; message?: string };

/** Result of paying (or confirming) the trade cash leg (ESC-05). */
export type TradeCashActionResult =
  | {
      ok: true;
      status: TradeCashStatus;
      /** The issuer asked for a 3-D Secure check. Never persisted, never logged. */
      nextAction?: { clientSecret: string; publishableKey?: string };
    }
  | { ok: false; error: TradeNegotiationError; message?: string };

/** Handover terms as the room's form submits them. */
export interface TradeTermsInput {
  cashAmountCents: number;
  cashDirection: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
  declaredValueCents?: number | null;
  /**
   * What the counterpart is handing over, in prose (0081).
   *
   * Required when the trade is against a SHOPFRONT, whose listing cannot say, and
   * refused otherwise. On a counter, null LEAVES the current description alone —
   * revising the postage must not erase the statement of what is being swapped.
   */
  counterpartGoodsDescription?: string | null;
  /**
   * How the goods change hands. An opening offer may omit this — the room is
   * where face-to-face vs delivery is settled. A counter that requires complete
   * terms still needs a method.
   */
  handoverMethod: 'DELIVERY' | 'IN_PERSON' | null;
  meetingLocation?: string | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  meetingAt?: string | null;
  deliveryDetails?: string | null;
  deliveryCostCents?: number | null;
  message?: string | null;
}

/**
 * Reads through the request-cached lookup rather than `auth.getUser()`, which
 * revalidates the JWT against the auth server on every call.
 */
async function currentUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
  return user?.id ?? null;
}

/** Load a Trade and establish that the caller is one of its two Traders. */
async function loadParticipantTrade(
  tradeId: string,
  userId: string,
): Promise<
  | { ok: true; trade: TradeRow; counterpartyId: string }
  | { ok: false; error: TradeNegotiationError }
> {
  const admin = createAdminClient();
  const { data } = await admin.from('trades').select('*').eq('id', tradeId).maybeSingle();
  const trade = data as TradeRow | null;
  if (!trade) return { ok: false, error: 'not-participant' };
  if (trade.initiator_id !== userId && trade.counterpart_id !== userId) {
    return { ok: false, error: 'not-participant' };
  }
  if (trade.state !== 'NEGOTIATING') return { ok: false, error: 'not-negotiating' };
  return {
    ok: true,
    trade,
    counterpartyId:
      trade.initiator_id === userId ? trade.counterpart_id : trade.initiator_id,
  };
}

/**
 * Validate handover terms before they reach SQL.
 *
 * A face-to-face swap needs a provider-resolved place and a future time, for the
 * same reason a Cash_Sale does: an invented pin is worse than no pin, because it
 * looks authoritative.
 */
function termsProblem(
  terms: TradeTermsInput,
  options?: { requireHandoverDetail?: boolean },
): string | null {
  if (
    !Number.isInteger(terms.cashAmountCents) ||
    terms.cashAmountCents < 0 ||
    terms.cashAmountCents > 100_000_000
  ) {
    return 'Enter a valid cash amount up to $1,000,000.';
  }
  // An OPENING offer does not have to name a handover method — that is one of
  // the things the room exists to settle. A counter is different: it is a
  // concrete proposal the other side is being asked to accept, so it must be
  // complete. Requiring a resolved place up front is what forced the old flow to
  // collect meeting details before the two traders had even spoken.
  if (!options?.requireHandoverDetail) return null;
  if (terms.handoverMethod !== 'DELIVERY' && terms.handoverMethod !== 'IN_PERSON') {
    return 'Choose how the goods change hands.';
  }

  // One validator, shared with the trade room's terms editor and with the Cash_Sale.
  // This function used to reimplement the resolved-place and future-time checks by
  // hand, one of three copies of the same rules.
  const validation = validateFulfilmentTerms(
    {
      method: terms.handoverMethod,
      meeting: {
        place: terms.meetingLocation?.trim()
          ? {
              label: terms.meetingLocation.trim(),
              placeId: terms.meetingPlaceId ?? '',
              lat: terms.meetingLat ?? Number.NaN,
              lng: terms.meetingLng ?? Number.NaN,
            }
          : null,
        at: terms.meetingAt ?? null,
      },
      delivery: {
        costCents: terms.deliveryCostCents ?? null,
        notes: null,
      },
    },
    // Face-to-face only, and a staleness bound on the date. Neither is derived from
    // the collateral any more — the hold is placed the day before the meeting, so the
    // authorisation does not start until the risk does.
    {
      allowedMethods: TRADE_HANDOVER_METHODS,
      maxMeetingLeadHours: MAX_MEETING_LEAD_HOURS,
    },
  );
  if (validation.ok) return null;

  switch (validation.error) {
    case 'meeting-place-required':
    case 'meeting-place-unresolved':
      return 'Choose a suggested meeting point.';
    case 'meeting-time-required':
    case 'meeting-time-past':
      return 'Choose a future meeting time.';
    case 'meeting-time-too-far':
      // Says the actual limit rather than "too far away", because the trader has to
      // pick a replacement and a vague refusal makes that guesswork.
      return `Choose a meeting time within ${MAX_MEETING_LEAD_HOURS / 24} days.`;
    case 'method-not-supported':
      return 'Trades are swapped in person. Choose a meeting point and time.';
    case 'delivery-cost-required':
    case 'delivery-cost-invalid':
      return 'Enter a valid postage amount.';
    default:
      return 'Choose how the goods change hands.';
  }
}

/** Map the room's terms onto the RPC's parameter names. */
function termsParams(terms: TradeTermsInput) {
  const inPerson = terms.handoverMethod === 'IN_PERSON';
  return {
    p_cash_amount_cents: Math.trunc(terms.cashAmountCents),
    p_cash_direction: terms.cashDirection,
    p_declared_value_cents: terms.declaredValueCents ?? null,
    p_handover_method: terms.handoverMethod ?? null,
    p_meeting_location: inPerson ? terms.meetingLocation?.trim() || null : null,
    p_meeting_lat: inPerson ? terms.meetingLat ?? null : null,
    p_meeting_lng: inPerson ? terms.meetingLng ?? null : null,
    p_meeting_place_id: inPerson ? terms.meetingPlaceId ?? null : null,
    p_meeting_at: inPerson ? terms.meetingAt ?? null : null,
    p_delivery_details: inPerson ? null : terms.deliveryDetails?.trim() || null,
    p_delivery_cost_cents: inPerson ? null : terms.deliveryCostCents ?? null,
    p_offer_message: terms.message?.trim() || null,
    p_counterpart_goods_description: terms.counterpartGoodsDescription?.trim() || null,
  };
}

/** Length bound for the binder-side goods statement; mirrors the CHECK in 0081. */
const COUNTERPART_GOODS_MAX_LENGTH = 1000;

/**
 * Counter: revise the cash (and binder goods) of a live negotiation.
 *
 * THE LISTING OWNER SETS THE PRICE. The counterpart is the owner of the
 * listing this trade was opened against. The initiator asks in chat; they
 * do not write the number. Handover is a separate save and does not come
 * through this action.
 *
 * A real cash / goods change bumps the terms version and clears both
 * acceptances, then re-applies the caller's own.
 */
export const proposeTradeTerms = withActionLog('tradeNegotiation.proposeTradeTerms', async function proposeTradeTerms(
  tradeId: string,
  expectedTermsVersion: number,
  terms: TradeTermsInput,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const loaded = await loadParticipantTrade(tradeId, userId);
  if (!loaded.ok) return loaded;

  if (userId !== loaded.trade.counterpart_id) {
    return {
      ok: false,
      error: 'not-permitted',
      message: 'Only the listing owner can change the cash on this trade.',
    };
  }

  const problem = termsProblem(terms);
  if (problem) return { ok: false, error: 'invalid-terms', message: problem };

  // Keep the handover already on the row. This action is cash / goods only;
  // meeting and postage are saved through `updateTradeHandoverTerms`.
  const current = loaded.trade;
  const handover: TradeTermsInput = {
    ...terms,
    handoverMethod: current.handover_method ?? terms.handoverMethod,
    meetingLocation: current.meeting_location,
    meetingLat: current.meeting_lat,
    meetingLng: current.meeting_lng,
    meetingPlaceId: current.meeting_place_id,
    meetingAt: current.meeting_at,
    deliveryDetails: current.delivery_details,
    deliveryCostCents: current.delivery_cost_cents,
  };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('update_trade_terms', {
    p_trade_id: tradeId,
    p_actor_id: userId,
    p_expected_terms_version: expectedTermsVersion,
    ...termsParams(handover),
  });
  if (error) {
    return {
      ok: false,
      error: 'rejected',
      message: 'Could not save those terms right now. Refresh and try again.',
    };
  }
  const row = (data as TradeRow[] | null)?.[0];
  if (!row) {
    return {
      ok: false,
      error: 'stale-terms',
      message: 'The terms changed while you were editing. Review the current version.',
    };
  }

  await createNotification({
    userId: loaded.counterpartyId,
    type: 'TRADE',
    title: 'Cash updated',
    body: 'The listing owner changed the cash on this trade. Accept the new amount to continue.',
    link: `/trades/${tradeId}`,
    context: tradeContext(tradeId, userId),
  });

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade: row, collateralStarted: false };
});

/**
 * Accept the terms on the table. When this is the SECOND acceptance the trade
 * moves into collateral: Items are reserved and bonds are placed.
 *
 * The Identity_Gate is checked for BOTH Traders here rather than at the offer,
 * because this is the Commitment_Point — an Objective_Fraud finding pays captured
 * collateral to whichever side was the victim, so either party can receive money
 * and neither may enter the collateral phase without a payout account. Opening and
 * countering an offer stay ungated: nothing is at stake until terms are agreed.
 */
export const acceptTradeTerms = withActionLog('tradeNegotiation.acceptTradeTerms', async function acceptTradeTerms(
  tradeId: string,
  termsVersion: number,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const loaded = await loadParticipantTrade(tradeId, userId);
  if (!loaded.ok) return loaded;

  // ESC-03 layer 3, again at the Commitment_Point: signals can arrive after opening.
  if (await membersAreRelated(userId, loaded.counterpartyId)) {
    return { ok: false, error: 'related-accounts', message: RELATED_ACCOUNTS_MESSAGE };
  }

  for (const partyId of [userId, loaded.counterpartyId]) {
    const gate = await readIdentityGate(partyId);
    if (!gate.satisfied) {
      return {
        ok: false,
        error: 'not-verified',
        message:
          partyId === userId
            ? identityGateMessage('trade', gate.state)
            : "The other trader hasn't verified with Stripe Identity yet.",
      };
    }
  }

  // ESC-04: collateral is placed a day before the MEETING, so terms with no meeting
  // instant (or a non-face-to-face method) would leave a trade with no placement
  // time, no inspection clock and no stale-sweep trigger. The SQL guard joins this
  // when WP3's migration redefines `begin_trade_collateral`.
  if (loaded.trade.handover_method !== 'IN_PERSON' || !loaded.trade.meeting_at) {
    return {
      ok: false,
      error: 'terms-incomplete',
      message: 'Set a meeting place and time before accepting.',
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('accept_trade_terms', {
    p_trade_id: tradeId,
    p_actor_id: userId,
    p_terms_version: termsVersion,
  });
  if (error) {
    return { ok: false, error: 'rejected', message: 'Could not record that. Please retry.' };
  }
  const accepted = (data as TradeRow[] | null)?.[0];
  if (!accepted) {
    return {
      ok: false,
      error: 'stale-terms',
      message: 'These terms are no longer current. Review the latest version.',
    };
  }

  const bothAccepted =
    accepted.initiator_terms_accepted_version === accepted.terms_version &&
    accepted.counterpart_terms_accepted_version === accepted.terms_version;
  if (!bothAccepted) {
    revalidatePath(`/trades/${tradeId}`);
    return { ok: true, trade: accepted, collateralStarted: false };
  }

  // Second acceptance: reserve the Items and move to COLLATERAL_PENDING. Guarded
  // in SQL on both ticks matching, so a double submit cannot start escrow twice.
  const { data: startedData, error: startError } = await admin.rpc('begin_trade_collateral', {
    p_trade_id: tradeId,
    p_actor_id: userId,
  });
  const started = (startedData as TradeRow[] | null)?.[0];
  // ESC-19 (0141): a card another contract already holds. The transition rolled back,
  // so the trade is still NEGOTIATING; say why instead of pretending it started.
  if (startError?.message.includes('short-reservation')) {
    revalidatePath(`/trades/${tradeId}`);
    return {
      ok: false,
      error: 'rejected',
      message: 'One of the cards in this trade is no longer available, so the trade could not start.',
    };
  }
  if (startError?.message.includes('terms-incomplete')) {
    return { ok: false, error: 'terms-incomplete', message: 'Set a meeting place and time before accepting.' };
  }
  if (startError || !started) {
    revalidatePath(`/trades/${tradeId}`);
    return { ok: true, trade: accepted, collateralStarted: false };
  }

  // ESC-18: freeze what each side is worth NOW, so a price edit after agreement
  // cannot shrink the collateral or the fee. A failed write is logged; placement
  // freezes the values itself if they are still missing.
  if (!(await freezeTradeSideValues(started, admin))) {
    await logBackgroundFailure({
      name: 'trade.side_values',
      errorCode: 'WRITE_FAILED',
      message: 'Side values could not be frozen at TERMS_AGREED.',
      context: { tradeId },
    });
  }

  // COLLATERAL IS NO LONGER PLACED HERE. It is authorised a day before the meeting by
  // `placeDueTradeCollateral`, because an authorisation lasts about seven days and
  // placing it now would spend that budget on waiting — agree today, meet in three
  // weeks, and the collateral is dead before anyone shakes hands. The Trade_Fee moves
  // with it, so "no exchange, no fee" still holds: nothing is billed until a card has
  // actually been authorised.
  //
  // What this call still does is bind both sides and reserve the Items, which is what
  // COLLATERAL_PENDING now means: agreed, off the market, waiting for its hold.
  //
  // ESC-05: a cash leg is opened here, unpaid. The payer pays it buyer-present before
  // any hold is placed; placement waits for it, and an unpaid leg at `pay_by` abandons
  // the trade. A failed write is logged; placement re-creates the row on its own.
  const hasCash = Number(started.cash_amount_cents ?? 0) > 0;
  if (hasCash && !(await ensureTradeCashSettlement(started, admin))) {
    await logBackgroundFailure({
      name: 'trade_cash.create',
      errorCode: 'WRITE_FAILED',
      message: 'The trade cash leg row could not be created at TERMS_AGREED.',
      context: { tradeId },
    });
  }
  const payerId = hasCash
    ? started.cash_direction === 'COUNTERPART_PAYS'
      ? started.counterpart_id
      : started.initiator_id
    : null;

  await createNotification({
    userId: loaded.counterpartyId,
    type: 'TRADE',
    title: 'Trade terms agreed',
    body:
      payerId === loaded.counterpartyId
        ? 'Both of you accepted the terms. Pay the agreed cash to lock the trade; the card holds go on the day before you meet.'
        : 'Both of you accepted the terms. The card holds go on the day before you meet.',
    link: `/trades/${tradeId}`,
    context: tradeContext(tradeId, userId),
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${tradeId}`);
  return {
    ok: true,
    trade: started,
    collateralStarted: true,
    ...(payerId === userId ? { nextAction: { kind: 'PAY_TRADE_CASH' as const } } : {}),
  };
});

/** Member-facing code and copy for a trade-cash refusal (ESC-05). */
function tradeCashFailure(error: TradeCashError, detail?: string): TradeCashActionResult {
  switch (error) {
    case 'NOT_FOUND':
    case 'NOT_PAYER':
      return { ok: false, error: 'not-participant' };
    case 'TRADE_CASH_PAY_BY_PASSED':
      return {
        ok: false,
        error: 'trade-cash-pay-by-passed',
        message: 'The deadline to pay the cash for this trade has passed, so it cannot lock.',
      };
    case 'NO_PAYMENT_METHOD':
      return { ok: false, error: 'no-payment-method', message: 'Add a card before you pay.' };
    case 'CASH_DECLINED':
      return {
        ok: false,
        error: 'cash-declined',
        message: detail ?? 'The card was declined. Nothing was charged. Try another card.',
      };
    case 'ALREADY_PAID':
      return { ok: false, error: 'not-permitted', message: 'The cash for this trade is already paid.' };
    case 'CONCURRENT':
      return { ok: false, error: 'not-permitted', message: detail ?? 'A payment is already in progress.' };
    default:
      return { ok: false, error: 'not-permitted', message: 'The trade is not waiting for this payment.' };
  }
}

async function tradeCashDeps(tradeId: string) {
  return createDefaultTradeCashDeps(getPaymentService(await regionForTrade(tradeId)));
}

/**
 * The paying trader pays the agreed cash (ESC-05). Buyer-present, so the card issuer
 * may ask for a 3-D Secure check, and BEFORE any collateral hold: the holds are placed
 * only once this is collected. Held by the platform until the trade completes.
 */
export const payTradeCash = withActionLog('tradeNegotiation.payTradeCash', async function payTradeCash(
  tradeId: string,
): Promise<TradeCashActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };
  const result = await payTradeCashCore(await tradeCashDeps(tradeId), { actorId: userId, tradeId });
  if (!result.ok) return tradeCashFailure(result.error, result.detail);
  revalidatePath(`/trades/${tradeId}`);
  return {
    ok: true,
    status: result.record.status,
    ...(result.nextAction ? { nextAction: result.nextAction } : {}),
  };
});

/** Read the trade cash payment back after a 3-D Secure check (ESC-05). Payer only. */
export const confirmTradeCashPayment = withActionLog('tradeNegotiation.confirmTradeCashPayment', async function confirmTradeCashPayment(
  tradeId: string,
): Promise<TradeCashActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };
  const result = await confirmTradeCashPaymentCore(await tradeCashDeps(tradeId), { actorId: userId, tradeId });
  if (!result.ok) return tradeCashFailure(result.error, result.detail);
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, status: result.record.status };
});

/** The outstanding 3-D Secure secret for the trade cash, read back from the provider. */
export const getTradeCashPaymentAction = withActionLog('tradeNegotiation.getTradeCashPaymentAction', async function getTradeCashPaymentAction(
  tradeId: string,
): Promise<
  | { ok: true; clientSecret: string | null; publishableKey?: string }
  | { ok: false; error: TradeNegotiationError }
> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };
  const result = await getTradeCashPaymentActionCore(await tradeCashDeps(tradeId), { actorId: userId, tradeId });
  return result.ok ? result : { ok: false, error: 'not-participant' };
});

// `itemIdsFor`, `chargeFeesForAgreedTrade` and `syncHolds` all moved to
// `lib/trades/collateralPlacement.ts`, next to the bond placement they are ordered
// against. The fee in particular has to stay adjacent to the authorisation: it is
// charged only after a card has actually been held, and separating the two is how an
// earlier version came to bill both traders 5% on a declined card.

/**
 * Re-seek collateral after a card decline. HOLDS_FAILED leaves the trade in
 * COLLATERAL_PENDING on purpose so this can run without going back to negotiation.
 *
 * Replacing the vaulted card is a separate action (`completeCardSetup`); this
 * only places a new authorisation against whatever is now the default card.
 */
export const retryTradeCollateral = withActionLog('tradeNegotiation.retryTradeCollateral', async function retryTradeCollateral(
  tradeId: string,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const admin = createAdminClient();
  const { data } = await admin.from('trades').select('*').eq('id', tradeId).maybeSingle();
  const trade = data as TradeRow | null;
  if (!trade) return { ok: false, error: 'not-participant' };
  if (trade.initiator_id !== userId && trade.counterpart_id !== userId) {
    return { ok: false, error: 'not-participant' };
  }
  if (trade.state !== 'COLLATERAL_PENDING') {
    return {
      ok: false,
      error: 'not-permitted',
      message: 'Collateral is not waiting to be retried on this trade.',
    };
  }

  for (const partyId of [trade.initiator_id, trade.counterpart_id]) {
    const gate = await readIdentityGate(partyId);
    if (!gate.satisfied) {
      return {
        ok: false,
        error: 'not-verified',
        message:
          partyId === userId
            ? identityGateMessage('trade', gate.state)
            : "The other trader hasn't verified with Stripe Identity yet.",
      };
    }
  }

  const repository = createSupabaseTradeProposalRepository(admin);
  const existing = await repository.getHolds(tradeId);

  // A retry while the first placement is still in flight would race it. Only
  // continue once a seek has already failed, or both latest holds are already
  // ACTIVE and just need confirming (process died between place and sync).
  if (currentHoldsCoverTraders(existing, [trade.initiator_id, trade.counterpart_id])) {
    // The one lock rule (ESC-08). It notifies both traders itself, exactly once, and
    // only when it actually moved the trade into COLLATERAL_LOCKED (FEAT-002).
    await confirmTradeCollateral({ tradeId, actorId: userId });
    revalidatePath(`/trades/${tradeId}`);
    return { ok: true, trade, collateralStarted: true };
  }
  if (existing.length === 0 || !currentHoldsSeekFailed(existing)) {
    return {
      ok: false,
      error: 'not-permitted',
      message: 'Collateral is still being arranged. Wait a moment, then try again if it fails.',
    };
  }

  // One placement path, shared with the scheduled pass. It voids any stray ACTIVE
  // hold, re-reserves the Items, authorises both cards, and only then charges the
  // Trade_Fee — an order that has to hold wherever collateral is placed from.
  const placement = await placeTradeCollateral({ tradeId, actorId: userId });
  if (!placement.ok) {
    return { ok: false, error: 'bond-failed', message: placement.message };
  }

  const counterpartyId =
    trade.initiator_id === userId ? trade.counterpart_id : trade.initiator_id;
  await createNotification({
    userId: counterpartyId,
    type: 'TRADE',
    title: 'Trade collateral retried',
    body: 'The other trader retried the card hold. Collateral is being arranged.',
    link: `/trades/${tradeId}`,
    context: tradeContext(tradeId, userId),
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade, collateralStarted: true };
});

/**
 * End a negotiation before terms are agreed. Either party, one outcome: the
 * Trade becomes CANCELLED and who ended it is recorded on the row.
 */
export const declineTradeOffer = withActionLog('tradeNegotiation.declineTradeOffer', async function declineTradeOffer(
  tradeId: string,
  reason?: string,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const loaded = await loadParticipantTrade(tradeId, userId);
  if (!loaded.ok) return loaded;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('decline_trade_negotiation', {
    p_trade_id: tradeId,
    p_actor_id: userId,
    p_reason: reason?.trim() || null,
  });
  const row = (data as TradeRow[] | null)?.[0];
  if (error || !row) {
    return { ok: false, error: 'rejected', message: 'Could not close that offer. Please retry.' };
  }

  await createNotification({
    userId: loaded.counterpartyId,
    type: 'TRADE',
    title: 'Trade offer closed',
    body: 'The other trader ended this offer. Nothing was charged.',
    link: `/trades/${tradeId}`,
    context: tradeContext(tradeId, userId),
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade: row, collateralStarted: false };
});

/** Result of opening a negotiation from a listing. */
export type OpenTradeNegotiationResult =
  | { ok: true; tradeId: string }
  | {
      ok: false;
      error:
        | TradeNegotiationError
        | 'item-unavailable'
        | 'self-trade'
        /** The two traders are not in the same enabled region (0065). */
        | 'region-mismatch'
        /** More than `contractLimiter` allows in a minute: every offer notifies. */
        | 'rate-limited';
      message?: string;
    };

/**
 * Open a negotiation on a Counterpart's listing (Req 5.1, 5.13).
 *
 * Replaces `createTradeProposal`. The Trade is created immediately at
 * NEGOTIATING with its room and thread, so the offer and every counter live in
 * one place instead of a chain of proposal rows.
 *
 * Deliberately NOT gated on the Identity_Gate. Making and answering an offer puts
 * nothing at stake; the gate applies at `acceptTradeTerms`, which is the
 * Commitment_Point. Gating the offer instead was what made a member with no
 * payout account unable even to start a conversation.
 */
export const openTradeNegotiation = withActionLog('tradeNegotiation.openTradeNegotiation', async function openTradeNegotiation(input: {
  counterpartItemId: string;
  /**
   * What the caller is putting up. `private` describes something not in the
   * catalog: the Item is created hidden first, exactly as `createTradeProposal`
   * did, so a trader can offer a card they never listed.
   */
  offer:
    | { kind: 'existing'; itemId: string }
    | {
        kind: 'private';
        description: string;
        category: string;
        condition: string;
        fmvCents: number;
        images: ImageInput[];
      };
  initiatorExtraItemIds?: string[];
  counterpartExtraItemIds?: string[];
  terms: TradeTermsInput;
}): Promise<OpenTradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };
  if (!(await contractLimiter.check(userId)).allowed) {
    return { ok: false, error: 'rate-limited', message: 'Too many offers in a row. Wait a minute and try again.' };
  }

  const problem = termsProblem(input.terms);
  if (problem) return { ok: false, error: 'invalid-terms', message: problem };

  // EVERY refusal below has to come before `createPrivateTradeItem`, which is why
  // the target checks are hoisted above it. A private offer item is a real row with
  // real uploaded images, and it is created hidden with no listing to reach it from —
  // so returning an error after creating one leaks a row and its Storage objects with
  // nothing that will ever clean them up. Availability and self-trade have always
  // been refused down here; the region guard (0065) would have been a third path into
  // the same leak.
  const admin = createAdminClient();
  const { data: itemRow } = await admin
    .from('items')
    .select('owner_id, status, listing_kind, closed_at')
    .eq('id', input.counterpartItemId)
    .maybeSingle();
  const target = itemRow as
    | {
        owner_id: string;
        status: string;
        listing_kind: string;
        closed_at: string | null;
      }
    | null;
  // Availability means different things by listing kind (0064). A SINGLE listing is
  // open while AVAILABLE; a binder is permanently AVAILABLE and is open until it is
  // closed. Testing status alone is what made a binder untradeable.
  const targetIsShopfront = target?.listing_kind === 'SHOPFRONT';
  const targetIsOpen = targetIsShopfront
    ? target?.closed_at === null
    : target?.status === 'AVAILABLE';
  if (!target || !targetIsOpen) {
    return {
      ok: false,
      error: 'item-unavailable',
      message: 'That listing is no longer available to trade for.',
    };
  }

  // Region precondition (0065). Unlike the Identity_Gate — which is deliberately
  // NOT checked here, because making an offer puts nothing at stake — region is
  // checked at the offer rather than at `acceptTradeTerms`, and the difference is
  // deliberate. An ungated Identity_Gate costs a member nothing: they can negotiate
  // now and onboard before committing. An ungated region cannot be resolved at all,
  // because neither trader can move: a swap needs goods posted both ways inside a
  // ~7-day card authorisation, so a cross-region trade is not a thing to warn about
  // later, it is a conversation with no possible ending. Letting it open would waste
  // both traders' time and then fail at the Commitment_Point.
  const { data: regions } = await admin
    .from('profiles')
    .select('id, region_code')
    .in('id', [userId, target.owner_id]);
  const regionOf = new Map(
    (regions ?? []).map((row) => [row.id as string, row.region_code as string | null]),
  );
  const mismatch = checkRegionCompatibility(
    regionOf.get(userId) ?? null,
    regionOf.get(target.owner_id) ?? null,
    // The runtime set, not the registry flag: a trade bonds both traders against a
    // real card authorisation and can end in a payout to either of them, so it needs
    // a Stripe platform account for the region to exist before it starts.
    operationalRegions(),
  );
  if (mismatch) {
    return {
      ok: false,
      error: 'region-mismatch',
      message: regionMismatchMessage(mismatch),
    };
  }
  // ESC-03 layer 3: two accounts sharing a card, payout account or person.
  if (await membersAreRelated(userId, target.owner_id, admin)) {
    return { ok: false, error: 'related-accounts', message: RELATED_ACCOUNTS_MESSAGE };
  }
  // A binder CAN be traded for since 0081, but the trade has to say what is coming
  // out of it — the listing cannot, and arbitration reads the contract and never the
  // listing. On a SINGLE listing the item IS that statement, so a second free-text
  // one is refused rather than stored and ignored. Enforced again in SQL, since a
  // Server Action is reachable by anyone who learns its id.
  const goods = input.terms.counterpartGoodsDescription?.trim() ?? '';
  if (targetIsShopfront) {
    if (goods === '') {
      return {
        ok: false,
        error: 'invalid-terms',
        message: 'Say which cards you want out of this listing.',
      };
    }
    if (goods.length > COUNTERPART_GOODS_MAX_LENGTH) {
      return {
        ok: false,
        error: 'invalid-terms',
        message: `Keep what you are asking for under ${COUNTERPART_GOODS_MAX_LENGTH} characters.`,
      };
    }
  } else if (goods !== '') {
    return {
      ok: false,
      error: 'invalid-terms',
      message: 'This listing is a single item, so what is being traded is already set.',
    };
  }
  if (target.owner_id === userId) return { ok: false, error: 'self-trade' };

  // Only now is the offer known to be openable, so this is the first safe point to
  // create a side of it. `private` describes something not in the catalog: the Item
  // is created hidden, exactly as `createTradeProposal` did, so a trader can offer a
  // card they never listed. Nothing can reach it except the negotiation below, which
  // is precisely why it must not be created for an offer that is about to be refused.
  let initiatorItemId: string;
  if (input.offer.kind === 'existing') {
    initiatorItemId = input.offer.itemId;
  } else {
    const created = await createPrivateTradeItem({
      description: input.offer.description,
      category: input.offer.category,
      condition: input.offer.condition,
      fmvCents: input.offer.fmvCents,
      images: input.offer.images,
    });
    if (!created.ok) {
      return {
        ok: false,
        error: 'invalid-terms',
        message: created.message ?? 'That item could not be created.',
      };
    }
    initiatorItemId = created.data.id;
  }

  const { data, error } = await admin.rpc('open_trade_negotiation', {
    p_initiator_id: userId,
    p_counterpart_id: target.owner_id,
    p_initiator_item_id: initiatorItemId,
    p_counterpart_item_id: input.counterpartItemId,
    p_initiator_extra_item_ids: input.initiatorExtraItemIds ?? null,
    p_counterpart_extra_item_ids: input.counterpartExtraItemIds ?? null,
    ...termsParams(input.terms),
  });
  if (error) {
    // Named refusals rather than one generic failure, because each of these is
    // something the member can actually do something about. The one-live-negotiation
    // index is the expected collision; the rest are the 0081 guards, which the action
    // has already checked — reaching them here means a direct call or a race.
    if (error.message.includes('trades_one_live_negotiation_idx')) {
      return {
        ok: false,
        error: 'rejected',
        message: 'You already have an open offer on this listing. Continue it in the trade room.',
      };
    }
    if (error.message.includes('shopfront-cannot-be-offered')) {
      return {
        ok: false,
        error: 'invalid-terms',
        message:
          'A binder or bulk listing cannot be put up as your side of a trade. Offer the individual cards instead.',
      };
    }
    if (error.message.includes('counterpart-goods-required')) {
      return {
        ok: false,
        error: 'invalid-terms',
        message: 'Say which cards you want out of this listing.',
      };
    }
    if (error.message.includes('counterpart-item-unavailable')) {
      return {
        ok: false,
        error: 'item-unavailable',
        message: 'That listing is no longer available to trade for.',
      };
    }
    // ESC-19 (0141): a card already reserved or sold cannot be offered.
    if (error.message.includes('initiator-item-unavailable')) {
      return {
        ok: false,
        error: 'item-unavailable',
        message: 'One of the cards you offered is no longer available. Remove it and try again.',
      };
    }
    return {
      ok: false,
      error: 'rejected',
      message: 'The offer could not be opened. Please try again.',
    };
  }

  const trade = data as TradeRow | null;
  if (!trade) return { ok: false, error: 'rejected' };

  await createNotification({
    userId: target.owner_id,
    type: 'TRADE',
    title: 'Trade offer received',
    body: 'Someone opened a trade offer on one of your listings.',
    link: `/trades/${trade.id}`,
    context: tradeContext(trade.id, userId),
  });

  void emailNotify.tradeOfferReceived({
    userId: target.owner_id as string,
    contractId: trade.id,
  });

  revalidatePath('/trades');
  return { ok: true, tradeId: trade.id };
});
