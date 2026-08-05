'use server';

// lib/actions/tradeNegotiation.ts
//
// Negotiating a Trade inside its own contract room. A Trade now exists from the
// FIRST offer in state NEGOTIATING, so countering is a versioned terms revision
// on the Trade rather than a chain of replacement `trade_proposals` rows, and the
// conversation spans negotiation, escrow and fulfilment without a seam.
//
// Thin by convention: authenticate, gate on the Identity_Gate where money can be
// received, delegate to one SQL function, revalidate. Every guard is repeated in
// SQL because these calls run as the service role.
//
// The money boundary is deliberate. `begin_trade_collateral` moves the row to
// COLLATERAL_PENDING and reserves the Items; the bonds are then placed by
// `placeBondsForAgreedTrade`, and HOLDS_CONFIRMED / HOLDS_FAILED are dispatched
// exactly as the single-click path does. No SQL function touches a payment.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { readIdentityGate, identityGateMessage } from '@/lib/identityGate';
import { createNotification } from '@/lib/notifications/createNotification';
import { createPrivateTradeItem, type ImageInput } from '@/lib/actions/listings';
import { getPaymentService, isLivePaymentsProvider } from '@/domain/services';
import { placeBondsForAgreedTrade } from '@/domain/orchestrator/tradeProposal';
import { chargeTradeFees, refundTradeFees } from '@/lib/actions/tradeFees';
import { createSupabaseTradeProposalRepository } from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { validateFulfilmentTerms } from '@/domain/fulfilment';
import type { Tables } from '@/lib/supabase/database.types';

type TradeRow = Tables<'trades'>;

export type TradeNegotiationError =
  | 'unauthenticated'
  | 'not-verified'
  | 'not-participant'
  | 'not-negotiating'
  | 'stale-terms'
  | 'invalid-terms'
  | 'rejected'
  | 'bond-failed';

export type TradeNegotiationResult =
  | { ok: true; trade: TradeRow; escrowStarted: boolean }
  | { ok: false; error: TradeNegotiationError; message?: string };

/** Handover terms as the room's form submits them. */
export interface TradeTermsInput {
  cashAmountCents: number;
  cashDirection: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
  declaredValueCents?: number | null;
  handoverMethod: 'DELIVERY' | 'IN_PERSON';
  meetingLocation?: string | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  meetingAt?: string | null;
  deliveryDetails?: string | null;
  deliveryCostCents?: number | null;
  message?: string | null;
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  if (!Number.isInteger(terms.cashAmountCents) || terms.cashAmountCents < 0) {
    return 'Enter a valid cash amount.';
  }
  // An OPENING offer only has to name a handover method — where and when to meet
  // is one of the things the room exists to settle. A counter is different: it is
  // a concrete proposal the other side is being asked to accept, so it must be
  // complete. Requiring a resolved place up front is what forced the old flow to
  // collect meeting details before the two traders had even spoken.
  if (!options?.requireHandoverDetail) return null;

  // One validator, shared with the trade room's terms editor and with the Cash_Sale.
  // This function used to reimplement the resolved-place and future-time checks by
  // hand, one of three copies of the same rules.
  const validation = validateFulfilmentTerms({
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
  });
  if (validation.ok) return null;

  switch (validation.error) {
    case 'meeting-place-required':
    case 'meeting-place-unresolved':
      return 'Choose a suggested meeting point.';
    case 'meeting-time-required':
    case 'meeting-time-past':
      return 'Choose a future meeting time.';
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
    p_handover_method: terms.handoverMethod,
    p_meeting_location: inPerson ? terms.meetingLocation?.trim() || null : null,
    p_meeting_lat: inPerson ? terms.meetingLat ?? null : null,
    p_meeting_lng: inPerson ? terms.meetingLng ?? null : null,
    p_meeting_place_id: inPerson ? terms.meetingPlaceId ?? null : null,
    p_meeting_at: inPerson ? terms.meetingAt ?? null : null,
    p_delivery_details: inPerson ? null : terms.deliveryDetails?.trim() || null,
    p_delivery_cost_cents: inPerson ? null : terms.deliveryCostCents ?? null,
    p_offer_message: terms.message?.trim() || null,
  };
}

/**
 * Counter: revise the terms of a live negotiation.
 *
 * Bumps the terms version and clears both acceptances, then re-applies the
 * caller's own — proposing terms means accepting them.
 */
export async function proposeTradeTerms(
  tradeId: string,
  expectedTermsVersion: number,
  terms: TradeTermsInput,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const loaded = await loadParticipantTrade(tradeId, userId);
  if (!loaded.ok) return loaded;

  const problem = termsProblem(terms, { requireHandoverDetail: true });
  if (problem) return { ok: false, error: 'invalid-terms', message: problem };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('update_trade_terms', {
    p_trade_id: tradeId,
    p_actor_id: userId,
    p_expected_terms_version: expectedTermsVersion,
    ...termsParams(terms),
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
    title: 'Counter offer received',
    body: 'The trade terms were revised. Review and accept them to continue.',
    link: `/trades/${tradeId}`,
  });

  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade: row, escrowStarted: false };
}

/**
 * Accept the terms on the table. When this is the SECOND acceptance the trade
 * moves into escrow: Items are reserved and bonds are placed.
 *
 * The Identity_Gate is checked for BOTH Traders here rather than at the offer,
 * because this is the Commitment_Point — an Objective_Fraud finding pays captured
 * collateral to whichever side was the victim, so either party can receive money
 * and neither may enter escrow without a payout account. Opening and countering
 * an offer stay ungated: nothing is at stake until terms are agreed.
 */
export async function acceptTradeTerms(
  tradeId: string,
  termsVersion: number,
): Promise<TradeNegotiationResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const loaded = await loadParticipantTrade(tradeId, userId);
  if (!loaded.ok) return loaded;

  for (const partyId of [userId, loaded.counterpartyId]) {
    const gate = await readIdentityGate(partyId);
    if (!gate.satisfied) {
      return {
        ok: false,
        error: 'not-verified',
        message:
          partyId === userId
            ? identityGateMessage('trade', gate.state)
            : 'The other trader has not finished payout setup, so this trade cannot enter escrow yet.',
      };
    }
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
    return { ok: true, trade: accepted, escrowStarted: false };
  }

  // Second acceptance: reserve the Items and move to COLLATERAL_PENDING. Guarded
  // in SQL on both ticks matching, so a double submit cannot start escrow twice.
  const { data: startedData, error: startError } = await admin.rpc('begin_trade_collateral', {
    p_trade_id: tradeId,
    p_actor_id: userId,
  });
  const started = (startedData as TradeRow[] | null)?.[0];
  if (startError || !started) {
    revalidatePath(`/trades/${tradeId}`);
    return { ok: true, trade: accepted, escrowStarted: false };
  }

  // Every trade now bonds BOTH traders (see `resolveTradeBonds`), so a saved card
  // is a hard prerequisite for escrow where it used to be optional for a verified
  // trader. That makes `payer-not-found` a routine, fixable outcome rather than an
  // edge case, and it needs to say so.
  const bonds = await placeBondsForAgreedTrade(
    {
      repository: createSupabaseTradeProposalRepository(admin),
      payments: getPaymentService(),
    },
    {
      tradeId,
      initiatorId: started.initiator_id,
      counterpartId: started.counterpart_id,
      initiatorItemIds: await itemIdsFor(tradeId, started.initiator_id),
      counterpartItemIds: await itemIdsFor(tradeId, started.counterpart_id),
    },
  );

  const orchestrator = createDefaultTradeOrchestrator({ payments: getPaymentService() });
  if (!bonds.ok) {
    // Collateral could not be sought. Run the documented HOLDS_FAILED
    // compensation (Req 5.6) rather than leaving a trade stuck mid-escrow.
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_FAILED', actorId: userId });
    // No exchange, no fee. Nothing has been charged yet at this point — the fee is
    // collected only after bonds are in place — but call it anyway so the path is
    // correct if that order ever changes.
    await refundTradeFees(tradeId);
    return {
      ok: false,
      error: 'bond-failed',
      message:
        bonds.error === 'payer-not-found'
          ? 'A saved card is needed to hold the DittoBond for this trade. Add one in your profile, then accept again.'
          : 'Collateral could not be arranged, so the trade was not started. Nothing was charged.',
    };
  }

  // The Commitment_Point: both sides are bound and collateral is in place, so the
  // Trade_Fee falls due. Charged AFTER bonds so a trade that cannot get collateral
  // never gets billed, and deliberately not allowed to block the exchange — a
  // failed fee is recorded for retry rather than held against the traders.
  const itemValue = async (traderId: string) => {
    const ids = await itemIdsFor(tradeId, traderId);
    if (ids.length === 0) return 0;
    const { data } = await admin.from('items').select('fmv_cents').in('id', ids);
    return ((data ?? []) as { fmv_cents: number | null }[]).reduce(
      (sum, row) => sum + Number(row.fmv_cents ?? 0),
      0,
    );
  };
  const [initiatorGives, counterpartGives] = await Promise.all([
    itemValue(started.initiator_id),
    itemValue(started.counterpart_id),
  ]);
  // Each trader is charged on what they RECEIVE: the other side's goods, plus any
  // cash coming their way.
  const cash = Number(started.cash_amount_cents ?? 0);
  const initiatorPaysCash = started.cash_direction === 'PROPOSER_PAYS';
  await chargeTradeFees({
    tradeId,
    initiatorId: started.initiator_id,
    counterpartId: started.counterpart_id,
    initiatorReceivesCents: counterpartGives + (initiatorPaysCash ? 0 : cash),
    counterpartReceivesCents: initiatorGives + (initiatorPaysCash ? cash : 0),
  });

  if (bonds.bondsRequired === 0) {
    // Nobody owes a bond, so no provider event will ever arrive to confirm one.
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId: userId });
  } else if (isLivePaymentsProvider()) {
    await syncHolds(tradeId, userId);
  }

  await createNotification({
    userId: loaded.counterpartyId,
    type: 'TRADE',
    title: 'Trade terms agreed',
    body: 'Both of you accepted the terms. Collateral is being arranged.',
    link: `/trades/${tradeId}`,
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade: started, escrowStarted: true };
}

/** Every Item a given Trader is putting into a Trade. */
async function itemIdsFor(tradeId: string, traderId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('trade_items')
    .select('item_id')
    .eq('trade_id', tradeId)
    .eq('trader_id', traderId);
  return ((data ?? []) as { item_id: string }[]).map((row) => row.item_id);
}

/**
 * Stripe authorisations resolve synchronously, so drive the transition from the
 * hold rows rather than waiting for a webhook. Mirrors `syncTradeHoldsFromStripe`
 * in the single-click path.
 */
async function syncHolds(tradeId: string, actorId: string): Promise<void> {
  const admin = createAdminClient();
  const holds = await createSupabaseTradeProposalRepository(admin).getHolds(tradeId);
  if (holds.length === 0) return;
  const orchestrator = createDefaultTradeOrchestrator({ payments: getPaymentService() });
  if (holds.every((hold) => hold.status === 'ACTIVE')) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_CONFIRMED', actorId });
    return;
  }
  if (holds.some((hold) => hold.status === 'FAILED')) {
    await orchestrator.applyEvent({ tradeId, event: 'HOLDS_FAILED', actorId });
  }
}

/**
 * End a negotiation before terms are agreed. Either party, one outcome: the
 * Trade becomes CANCELLED and who ended it is recorded on the row.
 */
export async function declineTradeOffer(
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
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, trade: row, escrowStarted: false };
}

/** Result of opening a negotiation from a listing. */
export type OpenTradeNegotiationResult =
  | { ok: true; tradeId: string }
  | { ok: false; error: TradeNegotiationError | 'item-unavailable' | 'self-trade'; message?: string };

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
export async function openTradeNegotiation(input: {
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
        title: string;
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

  const problem = termsProblem(input.terms);
  if (problem) return { ok: false, error: 'invalid-terms', message: problem };

  let initiatorItemId: string;
  if (input.offer.kind === 'existing') {
    initiatorItemId = input.offer.itemId;
  } else {
    const created = await createPrivateTradeItem({
      title: input.offer.title,
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

  const admin = createAdminClient();
  const { data: itemRow } = await admin
    .from('items')
    .select('owner_id, status')
    .eq('id', input.counterpartItemId)
    .maybeSingle();
  const target = itemRow as { owner_id: string; status: string } | null;
  if (!target || target.status !== 'AVAILABLE') {
    return {
      ok: false,
      error: 'item-unavailable',
      message: 'That listing is no longer available to trade for.',
    };
  }
  if (target.owner_id === userId) return { ok: false, error: 'self-trade' };

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
    // The one-live-negotiation index is the expected collision here, so name it
    // rather than reporting a generic failure the member cannot act on.
    const duplicate = error.message.includes('trades_one_live_negotiation_idx');
    return {
      ok: false,
      error: 'rejected',
      message: duplicate
        ? 'You already have an open offer on this listing. Continue it in the trade room.'
        : 'The offer could not be opened. Please try again.',
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
  });

  revalidatePath('/trades');
  return { ok: true, tradeId: trade.id };
}
