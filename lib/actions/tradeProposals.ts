'use server';

// lib/actions/tradeProposals.ts
//
// Server Actions for the Trade_Proposal step that now precedes Requirement 5.1.
//
// A Trader offers an Item — an existing listing of theirs, or one created
// privately for this offer — against a Counterpart's public listing. Nothing is
// reserved and no Bond is requested while the proposal is PENDING. Acceptance is
// the Counterpart's decision alone; only then is the Trade created and do Req
// 5.1 (reserve both Items) and Req 5.4 (size and place each Bond) apply.
//
// Authorization is enforced twice, per the project convention: RLS grants the
// two participants SELECT on `trade_proposals`, and the pure guards in
// `domain/orchestrator/tradeProposalRequest.ts` re-check participation, item
// availability, and equal Fair_Market_Value before every write.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createDefaultTradeProposalRequestRepository } from '@/domain/orchestrator/supabaseTradeProposalRequestRepository';
import {
  amendTradeProposal as amendTradeProposalUseCase,
  authorizeTradeProposalAcceptance,
  declineTradeProposal as declineTradeProposalUseCase,
  requestTradeProposal,
  withdrawTradeProposal as withdrawTradeProposalUseCase,
  type ProposalHandoverTerms,
  type RequestTradeProposalError,
  type RespondTradeProposalError,
  type TradeCashDirection,
  type TradeHandoverMethod,
} from '@/domain/orchestrator/tradeProposalRequest';
import { createPrivateTradeItem, type ImageInput } from '@/lib/actions/listings';
import { createNotification } from '@/lib/notifications/createNotification';
import { proposeTrade } from '@/lib/actions/trades';
import { getPaymentService } from '@/domain/services';
import { TRADE_PROPOSAL_MESSAGE_MAX } from '@/lib/marketplace-constants';
import {
  describeDelivery,
  toHandoverColumns,
  type HandoverMethod,
} from '@/lib/handover/terms';

/**
 * Client-facing handover payload for create / amend / counter. Amounts are
 * integer AUD cents; meetingAt may be a `datetime-local` value or ISO string.
 */
export interface TradeHandoverInput {
  method: HandoverMethod;
  meetingLocation?: string | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  meetingAt?: string | null;
  deliveryCostCents?: number | null;
  deliveryNotes?: string | null;
}

/** Normalize UI handover into the domain record shape. */
function toProposalHandover(input: TradeHandoverInput): ProposalHandoverTerms {
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
  return {
    handoverMethod: columns.handover_method as TradeHandoverMethod,
    meetingLocation: columns.meeting_location,
    meetingLat: columns.meeting_lat,
    meetingLng: columns.meeting_lng,
    meetingPlaceId: columns.meeting_place_id,
    meetingAt: columns.meeting_at,
    deliveryDetails: columns.delivery_details,
    deliveryCostCents: columns.delivery_cost_cents,
  };
}

/** Ensure DELIVERY always has a details blob when cost is set. */
function ensureDeliveryDetails(handover: ProposalHandoverTerms): ProposalHandoverTerms {
  if (
    handover.handoverMethod === 'DELIVERY' &&
    handover.deliveryCostCents != null &&
    !handover.deliveryDetails?.trim()
  ) {
    return {
      ...handover,
      deliveryDetails: describeDelivery(handover.deliveryCostCents, null),
    };
  }
  return handover;
}

/** Auth failure shared by every action here. */
type AuthError = 'unauthenticated';

/** Result of {@link createTradeProposal}. */
export type CreateTradeProposalResult =
  | { ok: true; proposalId: string }
  | {
      ok: false;
      error:
        | AuthError
        | RequestTradeProposalError
        | 'item-create-failed';
      field?: string;
      message?: string;
    };

/** Result of accepting, declining, or withdrawing a proposal. */
export type RespondTradeProposalResult =
  | { ok: true; tradeId?: string }
  | {
      ok: false;
      error: AuthError | RespondTradeProposalError | string;
      message?: string;
    };

/**
 * An image supplied for a privately offered Item: normally the object path of a
 * photo the browser already uploaded to Storage, so the file never rides inside
 * this action's body. Raw bytes are still accepted for non-browser callers.
 */
type ProposalImage = ImageInput;

/** What the proposer is putting up: an existing Item, or a new private one. */
export type ProposalOffer =
  | { kind: 'existing'; itemId: string }
  | {
      kind: 'private';
      title: string;
      description: string;
      category: string;
      condition: string;
      /** The proposer's own valuation of this Item. */
      fmvCents: number;
      images: ProposalImage[];
    };

/**
 * Offer a Trade on a Counterpart's listing.
 *
 * When `offer.kind` is `private` the Item is created first with `hidden = true`,
 * so it is owned and valued but never enters the catalog. If the proposal is
 * then rejected by a guard, the Item is left in place — it belongs to the
 * proposer and stays private, which is the documented behaviour rather than a
 * leak.
 */
export async function createTradeProposal(input: {
  counterpartItemId: string;
  offer: ProposalOffer;
  /** Further Items of the proposer's already listed or privately held goods. */
  extraItemIds?: string[];
  /** Cash amount in integer AUD cents. */
  cashAmountCents?: number;
  /** Whether the proposer pays cash or requests it from the Counterpart. */
  cashDirection?: TradeCashDirection;
  /** What the proposer says their whole side is worth, in AUD cents. */
  declaredValueCents?: number | null;
  message?: string | null;
  /** Face-to-face or postage — required for new offers. */
  handover: TradeHandoverInput;
}): Promise<CreateTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Resolve the Item being offered, creating it privately when asked.
  let proposerItemId: string;
  if (input.offer.kind === 'existing') {
    proposerItemId = input.offer.itemId;
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
        error:
          created.error === 'validation-error'
            ? 'item-create-failed'
            : 'item-create-failed',
        field: created.field,
        message: created.message,
      };
    }
    proposerItemId = created.data.id;
  }

  // Cash on a trade is agreed terms, not a Cash_Sale. Offers stay open without
  // payout setup; collateral covers risk unless both sides are verified, and
  // the cash leg settles later when the receiver can take payouts.
  const cashAmountCents = Math.trunc(input.cashAmountCents ?? 0);
  const cashDirection = input.cashDirection ?? 'PROPOSER_PAYS';

  const trimmed = (input.message ?? '').trim();
  const handover = ensureDeliveryDetails(toProposalHandover(input.handover));
  const result = await requestTradeProposal(
    {
      proposerId: user.id,
      // Overwritten by the use case with the requested Item's real owner.
      counterpartId: '',
      proposerItemId,
      extraItemIds: input.extraItemIds ?? [],
      cashAmountCents,
      cashDirection,
      declaredValueCents: input.declaredValueCents ?? null,
      counterpartItemId: input.counterpartItemId,
      message: trimmed === '' ? null : trimmed.slice(0, TRADE_PROPOSAL_MESSAGE_MAX),
      handover,
    },
    { repository: createDefaultTradeProposalRequestRepository() },
  );
  if (!result.ok) return { ok: false, error: result.error };

  await createNotification({
    userId: result.proposal.counterpartId,
    type: 'TRADE',
    title: 'Trade offer received',
    body: 'Someone offered an item in exchange for one of your listings.',
    link: '/trades',
  });

  revalidatePath('/trades');
  return { ok: true, proposalId: result.proposal.id };
}

/**
 * Accept a Trade offer. Only the Counterpart may accept.
 *
 * On success this is the moment Req 5.1 applies: the existing `proposeTrade`
 * action creates the Trade in COLLATERAL_PENDING, reserves both Items, and
 * places each Trader's Bond. The proposal is then bound to that Trade.
 *
 * ATOMICITY (demo-contract-ux Task 1.3): `proposeTrade` itself is a real
 * payment-provider call and cannot be wrapped in a database transaction, but
 * everything after it — recording the full bundle in `trade_items`, the cash
 * amount, and flipping the proposal to ACCEPTED — is bookkeeping that used to
 * run as three separate service-role calls. A failure between any of them left
 * a half-recorded Trade with a still-PENDING proposal. `finalize_trade_acceptance`
 * (0017_atomic_trade_acceptance.sql) now performs all three in one Postgres
 * function call, so they commit together or not at all. If that RPC itself
 * fails, the Trade already exists with Items reserved and holds placed, so this
 * action compensates by voiding any holds and restoring both Items to
 * AVAILABLE rather than leaving a silently broken accepted trade.
 */
export async function acceptTradeProposal(
  proposalId: string,
): Promise<RespondTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const repository = createDefaultTradeProposalRequestRepository();
  const authorized = await authorizeTradeProposalAcceptance(
    { proposalId, actorId: user.id },
    { repository },
  );
  if (!authorized.ok) return { ok: false, error: authorized.error };

  // The proposer initiates the resulting Trade, so the Trade is created on their
  // behalf through the trusted orchestrator path rather than the caller's.
  const created = await proposeTrade(
    authorized.initiatorItemId,
    authorized.counterpartItemId,
    {
      onBehalfOfUserId: authorized.initiatorId,
      initiatorExtraItemIds: authorized.initiatorExtraItemIds,
    },
  );
  if (!created.ok) {
    return { ok: false, error: created.error, message: created.detail };
  }

  const admin = createAdminClient();
  const { handover } = authorized;
  const { error: finalizeError } = await admin.rpc('finalize_trade_acceptance', {
    p_proposal_id: proposalId,
    p_trade_id: created.tradeId,
    p_actor_id: user.id,
    p_initiator_id: authorized.initiatorId,
    p_initiator_item_id: authorized.initiatorItemId,
    p_initiator_extra_item_ids: authorized.initiatorExtraItemIds,
    p_counterpart_item_id: authorized.counterpartItemId,
    p_cash_amount_cents: authorized.cashAmountCents,
    p_cash_direction: authorized.cashDirection,
    p_handover_method: handover.handoverMethod,
    p_meeting_location: handover.meetingLocation,
    p_meeting_lat: handover.meetingLat,
    p_meeting_lng: handover.meetingLng,
    p_meeting_place_id: handover.meetingPlaceId,
    p_meeting_at: handover.meetingAt,
    p_delivery_details: handover.deliveryDetails,
    p_delivery_cost_cents: handover.deliveryCostCents,
  });

  if (finalizeError) {
    // The Trade exists and holds may already be placed; leave it a broken
    // accepted trade for no one. Cancel it the same way a HOLDS_FAILED webhook
    // would: void any active holds and restore both Items to AVAILABLE. The
    // proposal itself stays PENDING (finalize_trade_acceptance re-validates
    // that before touching anything, so it was never flipped), and the failed
    // Trade is left as an inert COLLATERAL_PENDING row for audit purposes.
    const { data: holdRows } = await admin
      .from('pre_auth_holds')
      .select('hold_ref, status')
      .eq('trade_id', created.tradeId);
    for (const hold of holdRows ?? []) {
      if (hold.status === 'ACTIVE') {
        await getPaymentService().voidHold(hold.hold_ref as string);
        await admin
          .from('pre_auth_holds')
          .update({ status: 'VOIDED' })
          .eq('hold_ref', hold.hold_ref as string);
      }
    }
    const itemIds = [
      authorized.initiatorItemId,
      ...authorized.initiatorExtraItemIds,
      authorized.counterpartItemId,
    ];
    await admin.from('items').update({ status: 'AVAILABLE' }).in('id', itemIds);

    return {
      ok: false,
      error: 'not-pending',
      message: 'The offer could not be finalized. Please try accepting it again.',
    };
  }

  await createNotification({
    userId: authorized.proposal.proposerId,
    type: 'TRADE',
    title: 'Trade offer accepted',
    body: 'Your offer was accepted. Collateral is being arranged.',
    link: `/trades/${created.tradeId}`,
  });

  revalidatePath('/trades');
  revalidatePath(`/trades/${created.tradeId}`);
  return { ok: true, tradeId: created.tradeId };
}

/** Decline a Trade offer. Only the Counterpart may decline. */
export async function declineTradeProposal(
  proposalId: string,
): Promise<RespondTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const result = await declineTradeProposalUseCase(
    { proposalId, actorId: user.id },
    { repository: createDefaultTradeProposalRequestRepository() },
  );
  if (!result.ok) return { ok: false, error: result.error };

  await createNotification({
    userId: result.proposal.proposerId,
    type: 'TRADE',
    title: 'Trade offer declined',
    body: 'Your offer was declined. Nothing was held.',
    link: '/trades',
  });

  revalidatePath('/trades');
  return { ok: true };
}

/**
 * Revise your own pending offer: change the bundle, the cash, what you say your
 * side is worth, or the note. The primary Item stays put.
 */
export async function amendTradeProposal(input: {
  proposalId: string;
  extraItemIds?: string[];
  cashAmountCents?: number;
  cashDirection?: TradeCashDirection;
  declaredValueCents?: number | null;
  message?: string | null;
  handover?: TradeHandoverInput;
}): Promise<RespondTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const cashAmountCents = Math.trunc(input.cashAmountCents ?? 0);

  const trimmed = (input.message ?? '').trim();
  const handover = input.handover
    ? ensureDeliveryDetails(toProposalHandover(input.handover))
    : undefined;
  const result = await amendTradeProposalUseCase(
    {
      proposalId: input.proposalId,
      actorId: user.id,
      extraItemIds: input.extraItemIds ?? [],
      cashAmountCents,
      cashDirection: input.cashDirection,
      declaredValueCents: input.declaredValueCents ?? null,
      message: trimmed === '' ? null : trimmed.slice(0, TRADE_PROPOSAL_MESSAGE_MAX),
      handover,
    },
    { repository: createDefaultTradeProposalRequestRepository() },
  );
  if (!result.ok) return { ok: false, error: result.error };

  await createNotification({
    userId: result.proposal.counterpartId,
    type: 'TRADE',
    title: 'Offer updated',
    body: 'An offer you were sent has changed. Take another look before deciding.',
    link: '/trades',
  });

  revalidatePath('/trades');
  return { ok: true };
}

/** Withdraw your own pending Trade offer. */
export async function withdrawTradeProposal(
  proposalId: string,
): Promise<RespondTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const result = await withdrawTradeProposalUseCase(
    { proposalId, actorId: user.id },
    { repository: createDefaultTradeProposalRequestRepository() },
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/trades');
  return { ok: true };
}

/**
 * Counter a Trade offer: refuse it as it stands and answer with your own terms.
 *
 * This is what makes a many-for-many swap possible. A fresh offer can only put a
 * bundle against one listing, because that listing is the entry point. Countering
 * reverses the roles — the recipient becomes the proposer and can put their own
 * bundle and cash against the goods they were offered — so over one or two rounds
 * both sides end up describing exactly what they are giving.
 *
 * The original offer is closed SUPERSEDED rather than declined, so the history
 * shows it was answered rather than refused outright.
 */
export async function counterTradeProposal(input: {
  proposalId: string;
  /** The Item from the original offer you want, and any others in that offer. */
  wantedItemId: string;
  /** Your own primary Item, plus any bundle and optional cash terms. */
  offeredItemId: string;
  extraItemIds?: string[];
  cashAmountCents?: number;
  cashDirection?: TradeCashDirection;
  declaredValueCents?: number | null;
  message?: string | null;
  /** Face-to-face or postage — required on the counter. */
  handover: TradeHandoverInput;
}): Promise<CreateTradeProposalResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const repository = createDefaultTradeProposalRequestRepository();
  const original = await repository.getProposal(input.proposalId);
  if (!original) return { ok: false, error: 'item-not-found' };
  // Only the side being offered to may counter, and only while it is live.
  if (original.status !== 'PENDING' || original.counterpartId !== user.id) {
    return { ok: false, error: 'not-owner' };
  }
  // The wanted Item has to be one the original offer actually put up.
  const offeredInOriginal = [original.proposerItemId, ...original.extraItemIds];
  if (!offeredInOriginal.includes(input.wantedItemId)) {
    return { ok: false, error: 'item-not-found' };
  }

  const cashAmountCents = Math.trunc(input.cashAmountCents ?? 0);
  const cashDirection = input.cashDirection ?? 'PROPOSER_PAYS';

  const trimmed = (input.message ?? '').trim();
  const handover = ensureDeliveryDetails(toProposalHandover(input.handover));
  const result = await requestTradeProposal(
    {
      proposerId: user.id,
      counterpartId: '',
      proposerItemId: input.offeredItemId,
      extraItemIds: input.extraItemIds ?? [],
      cashAmountCents,
      cashDirection,
      declaredValueCents: input.declaredValueCents ?? null,
      counterpartItemId: input.wantedItemId,
      // The goods in the original offer may be privately held rather than listed.
      allowPrivateTarget: true,
      message: trimmed === '' ? null : trimmed.slice(0, TRADE_PROPOSAL_MESSAGE_MAX),
      handover,
    },
    { repository },
  );
  if (!result.ok) return { ok: false, error: result.error };

  // Close the original only once its replacement exists, so a failure here never
  // leaves the pair with nothing pending.
  await repository.closeProposal(input.proposalId, 'SUPERSEDED');

  await createNotification({
    userId: original.proposerId,
    type: 'TRADE',
    title: 'Counter offer received',
    body: 'Your offer was answered with different terms.',
    link: '/trades',
  });

  revalidatePath('/trades');
  return { ok: true, proposalId: result.proposal.id };
}

/** A proposal summarized for the Trades section. */
export interface TradeProposalSummary {
  id: string;
  direction: 'incoming' | 'outgoing';
  counterpartyName: string;
  message: string | null;
  createdAt: string;
  /** The whole offered bundle; the primary Item first. */
  offered: {
    id: string;
    title: string;
    fmvCents: number;
    imagePath: string | null;
    hidden: boolean;
  }[];
  requested: { id: string; title: string; fmvCents: number; imagePath: string | null };
  /** Cash amount in integer AUD cents. */
  cashAmountCents: number;
  /** Which participant pays the cash. */
  cashDirection: TradeCashDirection;
  /** The proposer's own valuation of their side, when they gave one. */
  declaredValueCents: number | null;
  /** Face-to-face or postage summary for the inbox card. */
  handoverMethod: TradeHandoverMethod | null;
  meetingLocation: string | null;
  deliveryCostCents: number | null;
  deliveryDetails: string | null;
}

/**
 * List the caller's PENDING proposals in both directions.
 *
 * Item titles and images are read with the service-role client because a
 * privately offered Item is deliberately absent from the catalog: the
 * Counterpart must be able to inspect exactly what they are being offered, and
 * only ever within a proposal they are party to.
 */
export async function listMyTradeProposals(): Promise<
  | { ok: true; proposals: TradeProposalSummary[] }
  | { ok: false; error: AuthError | 'read-failed' }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // RLS scopes this to proposals the caller participates in.
  const { data, error } = await supabase
    .from('trade_proposals')
    .select(
      'id, proposer_id, counterpart_id, proposer_item_id, counterpart_item_id, message, created_at, cash_amount_cents, cash_direction, declared_value_cents, handover_method, meeting_location, delivery_cost_cents, delivery_details, trade_proposal_items(item_id)',
    )
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: 'read-failed' };

  const rows = data ?? [];
  if (rows.length === 0) return { ok: true, proposals: [] };

  const admin = createAdminClient();
  /** Extra bundle Item ids for one proposal row. */
  const extrasOf = (row: { trade_proposal_items?: { item_id: string }[] | null }) =>
    (row.trade_proposal_items ?? []).map((entry) => entry.item_id);

  const itemIds = Array.from(
    new Set(
      rows.flatMap((r) => [r.proposer_item_id, ...extrasOf(r), r.counterpart_item_id]),
    ),
  );
  const profileIds = Array.from(
    new Set(rows.flatMap((r) => [r.proposer_id, r.counterpart_id])),
  );

  const [{ data: itemRows }, { data: profileRows }] = await Promise.all([
    admin
      .from('items')
      .select('id, title, fmv_cents, image_paths, hidden')
      .in('id', itemIds),
    admin.from('profiles').select('id, display_name').in('id', profileIds),
  ]);

  const itemsById = new Map(
    (itemRows ?? []).map((item) => [
      item.id as string,
      {
        id: item.id as string,
        title: (item.title as string) ?? 'Item',
        fmvCents: (item.fmv_cents as number) ?? 0,
        imagePath: ((item.image_paths as string[] | null) ?? [])[0] ?? null,
        hidden: Boolean(item.hidden),
      },
    ]),
  );
  const namesById = new Map(
    (profileRows ?? []).map((p) => [p.id as string, (p.display_name as string) ?? 'NoDitto member']),
  );

  const proposals: TradeProposalSummary[] = [];
  for (const row of rows) {
    const primary = itemsById.get(row.proposer_item_id);
    const requested = itemsById.get(row.counterpart_item_id);
    if (!primary || !requested) continue;
    const offered = [
      primary,
      ...extrasOf(row)
        .map((id) => itemsById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ];
    const incoming = row.counterpart_id === user.id;
    proposals.push({
      id: row.id,
      direction: incoming ? 'incoming' : 'outgoing',
      counterpartyName:
        namesById.get(incoming ? row.proposer_id : row.counterpart_id) ??
        'NoDitto member',
      message: row.message,
      createdAt: row.created_at,
      offered,
      requested,
      cashAmountCents: row.cash_amount_cents ?? 0,
      cashDirection: row.cash_direction as TradeCashDirection,
      declaredValueCents: row.declared_value_cents ?? null,
      handoverMethod: (row.handover_method as TradeHandoverMethod | null) ?? null,
      meetingLocation: row.meeting_location ?? null,
      deliveryCostCents: row.delivery_cost_cents ?? null,
      deliveryDetails: row.delivery_details ?? null,
    });
  }

  return { ok: true, proposals };
}
