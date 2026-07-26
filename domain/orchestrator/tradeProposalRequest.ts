// domain/orchestrator/tradeProposalRequest.ts
//
// Trade_Proposal negotiation: the step that now precedes Requirement 5.1.
//
// A Trader offers one of their own Items — publicly listed or privately held —
// against a Counterpart's listed Item. While the proposal is PENDING nothing is
// reserved and no Pre_Auth_Hold is requested. Only when the Counterpart accepts
// does the Trade get created, at which point Req 5.1 (reserve both Items) and
// Req 5.4 (size and place each Bond) take over in `tradeProposal.ts`.
//
// Pure module: no Supabase, no React, no service imports. The Supabase-backed
// repository lives in `supabaseTradeProposalRequestRepository.ts`.

/** Availability status of an Item, mirroring the `item_status` enum. */
export type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

/** Lifecycle of a Trade_Proposal, mirroring `trade_proposal_status`. */
export type TradeProposalStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'SUPERSEDED';

/** The Item fields the negotiation needs: ownership, value, availability. */
export interface ProposalItemRecord {
  id: string;
  ownerId: string;
  /** Fair_Market_Value in integer AUD cents; equality is checked to the cent. */
  fmvCents: number;
  status: ItemStatus;
  /** True when the Item is privately offered and absent from the catalog. */
  hidden: boolean;
}

/** A persisted Trade_Proposal row. */
export interface TradeProposalRecord {
  id: string;
  proposerId: string;
  counterpartId: string;
  proposerItemId: string;
  /** Further Items in the proposer's bundle; empty for a straight 1:1 swap. */
  extraItemIds: string[];
  counterpartItemId: string;
  cashAmountCents: number;
  declaredValueCents: number | null;
  status: TradeProposalStatus;
  message: string | null;
  tradeId: string | null;
}

/** Fields needed to persist a new PENDING proposal. */
export interface CreateProposalParams {
  proposerId: string;
  counterpartId: string;
  /** The primary Item offered. Always present, so 1:1 offers are unchanged. */
  proposerItemId: string;
  /** Any further Items in the proposer's bundle. */
  extraItemIds?: string[];
  counterpartItemId: string;
  /** Cash the proposer adds on top of their goods, proposer -> counterpart. */
  cashAmountCents?: number;
  /**
   * What the proposer says their whole side is worth. Recorded for the
   * Counterpart to judge; never used to size a Bond.
   */
  declaredValueCents?: number | null;
  /**
   * Permit targeting an Item that is not publicly listed. Set only when
   * countering an existing offer, never from a fresh one.
   */
  allowPrivateTarget?: boolean;
  message: string | null;
}

/** Data-access seam for Trade_Proposal reads and writes. */
export interface TradeProposalRequestRepository {
  getItem(itemId: string): Promise<ProposalItemRecord | null>;
  getProposal(proposalId: string): Promise<TradeProposalRecord | null>;
  /** True when this proposer already has a PENDING offer on that Item. */
  hasPendingProposal(
    proposerId: string,
    counterpartItemId: string,
  ): Promise<boolean>;
  createProposal(params: CreateProposalParams): Promise<TradeProposalRecord>;
  /** Close a proposal with a terminal status, recording the decision time. */
  closeProposal(
    proposalId: string,
    status: Exclude<TradeProposalStatus, 'PENDING' | 'ACCEPTED'>,
  ): Promise<TradeProposalRecord | null>;
  /** Mark a proposal ACCEPTED and bind it to the created Trade. */
  markAccepted(
    proposalId: string,
    tradeId: string,
  ): Promise<TradeProposalRecord | null>;
  /**
   * Replace the terms of a PENDING proposal in place, including its bundle.
   * Editing in place rather than superseding keeps the offer the Counterpart is
   * looking at, so they see revised terms instead of it vanishing and reappearing.
   */
  updateProposalTerms(params: {
    proposalId: string;
    extraItemIds: string[];
    cashAmountCents: number;
    declaredValueCents: number | null;
    message: string | null;
  }): Promise<TradeProposalRecord | null>;
}

/**
 * Typed failures for {@link requestTradeProposal}. Every guard runs before any
 * write, so a rejected request leaves both Items untouched.
 * - `item-not-found`    — either Item does not exist.
 * - `not-owner`         — the proposer does not own the Item they offered.
 * - `self-trade`        — both Items belong to the same Trader.
 * - `item-unavailable`  — either Item's status is not AVAILABLE.
 * - `counterpart-item-private` — the requested Item is not publicly listed.
 * - `duplicate-pending` — this proposer already has a live offer on that Item.
 */
export type RequestTradeProposalError =
  | 'item-not-found'
  | 'not-owner'
  | 'self-trade'
  | 'item-unavailable'
  | 'counterpart-item-private'
  | 'invalid-cash'
  | 'invalid-declared-value'
  | 'empty-offer'
  | 'duplicate-pending';

export type RequestTradeProposalResult =
  | { ok: true; proposal: TradeProposalRecord }
  | { ok: false; error: RequestTradeProposalError };

/**
 * Create a PENDING Trade_Proposal, for one Item or a bundle plus cash.
 *
 * Guards, in order: every Item exists and is AVAILABLE; the proposer owns each
 * Item they offer; the sides belong to different Traders; the requested Item is
 * publicly listed; cash and declared value are sane; and the proposer has no live
 * offer on that Item already.
 *
 * NOT guarded: that the two sides are worth the same. A bundle plus cash cannot
 * be compared to a listing price by the system, and the goods may be unlisted and
 * unpriced. The Counterpart's acceptance is what agrees the valuation (Req 5.2);
 * CardTrade does not appraise goods. The declared value is recorded for them to
 * judge, and deliberately does not size either Bond — that is sized on what each
 * Trader receives, so understating a bundle cannot reduce the proposer's exposure.
 *
 * Offered Items MAY be hidden — that is the privately offered case. The requested
 * Item may not be, since a proposal can only target a public listing.
 */
export async function requestTradeProposal(
  params: CreateProposalParams,
  deps: { repository: TradeProposalRequestRepository },
): Promise<RequestTradeProposalResult> {
  const { repository } = deps;

  const cashAmountCents = Math.trunc(params.cashAmountCents ?? 0);
  if (!Number.isFinite(cashAmountCents) || cashAmountCents < 0) {
    return { ok: false, error: 'invalid-cash' };
  }
  if (
    params.declaredValueCents != null &&
    (!Number.isFinite(params.declaredValueCents) ||
      Math.trunc(params.declaredValueCents) <= 0)
  ) {
    return { ok: false, error: 'invalid-declared-value' };
  }

  // De-duplicate the bundle and drop the primary Item if it was repeated.
  const extraItemIds = Array.from(new Set(params.extraItemIds ?? [])).filter(
    (id) => id && id !== params.proposerItemId,
  );

  const [requested, ...offeredItems] = await Promise.all([
    repository.getItem(params.counterpartItemId),
    repository.getItem(params.proposerItemId),
    ...extraItemIds.map((id) => repository.getItem(id)),
  ]);
  if (!requested || offeredItems.some((item) => !item)) {
    return { ok: false, error: 'item-not-found' };
  }
  const offered = offeredItems as ProposalItemRecord[];

  if (offered.some((item) => item.ownerId !== params.proposerId)) {
    return { ok: false, error: 'not-owner' };
  }
  if (requested.ownerId === params.proposerId) {
    return { ok: false, error: 'self-trade' };
  }
  if (
    requested.status !== 'AVAILABLE' ||
    offered.some((item) => item.status !== 'AVAILABLE')
  ) {
    return { ok: false, error: 'item-unavailable' };
  }
  // A public listing is the entry point for a fresh offer. A counter-offer is
  // exempt: it answers an existing offer, whose goods may be privately held.
  if (requested.hidden && !params.allowPrivateTarget) {
    return { ok: false, error: 'counterpart-item-private' };
  }

  if (await repository.hasPendingProposal(params.proposerId, requested.id)) {
    return { ok: false, error: 'duplicate-pending' };
  }

  const proposal = await repository.createProposal({
    ...params,
    extraItemIds,
    cashAmountCents,
    declaredValueCents:
      params.declaredValueCents == null ? null : Math.trunc(params.declaredValueCents),
    // The counterpart is always the owner of the requested Item, never a
    // client-supplied value.
    counterpartId: requested.ownerId,
  });
  return { ok: true, proposal };
}

/**
 * Revise your own PENDING offer.
 *
 * Only the proposer may edit, and only while the offer is still open. The primary
 * Item is fixed — changing what you are fundamentally offering is a new offer, not
 * an edit — but the rest of the bundle, the cash, the stated value and the note can
 * all change. Any acceptance the Counterpart had not yet given is unaffected,
 * because acceptance is a single act on the current terms.
 */
export async function amendTradeProposal(
  params: {
    proposalId: string;
    actorId: string;
    extraItemIds?: string[];
    cashAmountCents?: number;
    declaredValueCents?: number | null;
    message?: string | null;
  },
  deps: { repository: TradeProposalRequestRepository },
): Promise<RequestTradeProposalResult> {
  const proposal = await deps.repository.getProposal(params.proposalId);
  if (!proposal) return { ok: false, error: 'item-not-found' };
  if (proposal.status !== 'PENDING' || proposal.proposerId !== params.actorId) {
    return { ok: false, error: 'not-owner' };
  }

  const cashAmountCents = Math.trunc(params.cashAmountCents ?? 0);
  if (!Number.isFinite(cashAmountCents) || cashAmountCents < 0) {
    return { ok: false, error: 'invalid-cash' };
  }
  if (
    params.declaredValueCents != null &&
    (!Number.isFinite(params.declaredValueCents) ||
      Math.trunc(params.declaredValueCents) <= 0)
  ) {
    return { ok: false, error: 'invalid-declared-value' };
  }

  const extraItemIds = Array.from(new Set(params.extraItemIds ?? [])).filter(
    (id) => id && id !== proposal.proposerItemId,
  );
  const extras = await Promise.all(
    extraItemIds.map((id) => deps.repository.getItem(id)),
  );
  if (extras.some((item) => !item)) return { ok: false, error: 'item-not-found' };
  if (extras.some((item) => item!.ownerId !== params.actorId)) {
    return { ok: false, error: 'not-owner' };
  }
  if (extras.some((item) => item!.status !== 'AVAILABLE')) {
    return { ok: false, error: 'item-unavailable' };
  }

  const updated = await deps.repository.updateProposalTerms({
    proposalId: params.proposalId,
    extraItemIds,
    cashAmountCents,
    declaredValueCents:
      params.declaredValueCents == null ? null : Math.trunc(params.declaredValueCents),
    message: params.message ?? null,
  });
  if (!updated) return { ok: false, error: 'not-owner' };
  return { ok: true, proposal: updated };
}

/**
 * Typed failures for responding to a proposal.
 * - `proposal-not-found` — no such proposal.
 * - `not-permitted`      — the caller is not the Trader entitled to this action.
 * - `not-pending`        — the proposal was already decided.
 * - `item-unavailable`   — an Item left AVAILABLE, so the offer has lapsed.
 */
export type RespondTradeProposalError =
  | 'proposal-not-found'
  | 'not-permitted'
  | 'not-pending'
  | 'item-unavailable';

export type DeclineTradeProposalResult =
  | { ok: true; proposal: TradeProposalRecord }
  | { ok: false; error: RespondTradeProposalError };

/**
 * Decline a PENDING proposal. Only the Counterpart may decline. Nothing was
 * reserved while pending, so declining has no payment or availability effect.
 */
export async function declineTradeProposal(
  params: { proposalId: string; actorId: string },
  deps: { repository: TradeProposalRequestRepository },
): Promise<DeclineTradeProposalResult> {
  const proposal = await deps.repository.getProposal(params.proposalId);
  if (!proposal) return { ok: false, error: 'proposal-not-found' };
  if (proposal.status !== 'PENDING') return { ok: false, error: 'not-pending' };
  if (proposal.counterpartId !== params.actorId) {
    return { ok: false, error: 'not-permitted' };
  }

  const closed = await deps.repository.closeProposal(proposal.id, 'DECLINED');
  if (!closed) return { ok: false, error: 'not-pending' };
  return { ok: true, proposal: closed };
}

/**
 * Withdraw a PENDING proposal. Only the proposer may withdraw.
 */
export async function withdrawTradeProposal(
  params: { proposalId: string; actorId: string },
  deps: { repository: TradeProposalRequestRepository },
): Promise<DeclineTradeProposalResult> {
  const proposal = await deps.repository.getProposal(params.proposalId);
  if (!proposal) return { ok: false, error: 'proposal-not-found' };
  if (proposal.status !== 'PENDING') return { ok: false, error: 'not-pending' };
  if (proposal.proposerId !== params.actorId) {
    return { ok: false, error: 'not-permitted' };
  }

  const closed = await deps.repository.closeProposal(proposal.id, 'WITHDRAWN');
  if (!closed) return { ok: false, error: 'not-pending' };
  return { ok: true, proposal: closed };
}

/**
 * Re-validate a PENDING proposal on behalf of the accepting Counterpart.
 *
 * Returns the pairing to hand to `proposeTrade`, which then performs Req 5.1
 * (create the Trade, reserve both Items) and Req 5.4 (size and place the Bonds).
 * Splitting acceptance this way keeps this module free of payment concerns: it
 * answers only "may this proposal become a Trade, and between which Items".
 *
 * Availability and value are re-checked here because a proposal can sit pending
 * while either Item is sold, reserved, or repriced.
 */
export async function authorizeTradeProposalAcceptance(
  params: { proposalId: string; actorId: string },
  deps: { repository: TradeProposalRequestRepository },
): Promise<
  | {
      ok: true;
      proposal: TradeProposalRecord;
      initiatorId: string;
      initiatorItemId: string;
      initiatorExtraItemIds: string[];
      counterpartItemId: string;
      cashAmountCents: number;
    }
  | { ok: false; error: RespondTradeProposalError }
> {
  const proposal = await deps.repository.getProposal(params.proposalId);
  if (!proposal) return { ok: false, error: 'proposal-not-found' };
  if (proposal.status !== 'PENDING') return { ok: false, error: 'not-pending' };
  // Only the Counterpart may accept; the proposer accepting their own offer
  // would defeat the point of the acceptance step.
  if (proposal.counterpartId !== params.actorId) {
    return { ok: false, error: 'not-permitted' };
  }

  // Every Item on both sides must still be available. Value is NOT re-checked:
  // the Counterpart agreed the valuation by accepting, and a bundle has no
  // system-comparable price.
  const itemIds = [
    proposal.proposerItemId,
    ...proposal.extraItemIds,
    proposal.counterpartItemId,
  ];
  const items = await Promise.all(itemIds.map((id) => deps.repository.getItem(id)));
  if (items.some((item) => !item || item.status !== 'AVAILABLE')) {
    return { ok: false, error: 'item-unavailable' };
  }

  return {
    ok: true,
    proposal,
    // The proposer initiates the resulting Trade: they offered first.
    initiatorId: proposal.proposerId,
    initiatorItemId: proposal.proposerItemId,
    initiatorExtraItemIds: proposal.extraItemIds,
    counterpartItemId: proposal.counterpartItemId,
    cashAmountCents: proposal.cashAmountCents,
  };
}
