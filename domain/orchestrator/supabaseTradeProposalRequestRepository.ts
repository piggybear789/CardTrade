// domain/orchestrator/supabaseTradeProposalRequestRepository.ts
//
// Production wiring of the Trade_Proposal negotiation seam
// (`TradeProposalRequestRepository`), backed by the service-role admin client.
// Mirrors `supabaseTradeProposalRepository.ts`: RLS grants the two participants
// SELECT on `trade_proposals`, while every write runs through this trusted path
// after the pure guards in `tradeProposalRequest.ts` have passed.
//
// This binding is kept out of `tradeProposalRequest.ts` so the domain tests can
// import that module with an in-memory fake and no `server-only` dependency.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  CreateProposalParams,
  ProposalHandoverTerms,
  ProposalItemRecord,
  TradeCashDirection,
  TradeHandoverMethod,
  TradeProposalRecord,
  TradeProposalRequestRepository,
  TradeProposalStatus,
} from './tradeProposalRequest';
import { EMPTY_PROPOSAL_HANDOVER } from './tradeProposalRequest';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/** The `trade_proposals` columns this repository reads. */
const PROPOSAL_COLUMNS =
  'id, proposer_id, counterpart_id, proposer_item_id, counterpart_item_id, status, message, trade_id, cash_amount_cents, cash_direction, declared_value_cents, handover_method, meeting_location, meeting_lat, meeting_lng, meeting_place_id, meeting_at, delivery_details, delivery_cost_cents, trade_proposal_items(item_id)';

interface ProposalRow {
  id: string;
  proposer_id: string;
  counterpart_id: string;
  proposer_item_id: string;
  counterpart_item_id: string;
  status: TradeProposalStatus;
  message: string | null;
  trade_id: string | null;
  cash_amount_cents: number | null;
  cash_direction: TradeCashDirection;
  declared_value_cents: number | null;
  handover_method: TradeHandoverMethod | null;
  meeting_location: string | null;
  meeting_lat: number | null;
  meeting_lng: number | null;
  meeting_place_id: string | null;
  meeting_at: string | null;
  delivery_details: string | null;
  delivery_cost_cents: number | null;
  /** Embedded bundle rows from the joined select. */
  trade_proposal_items?: { item_id: string }[] | null;
}

function handoverFromRow(row: ProposalRow): ProposalHandoverTerms {
  return {
    handoverMethod: row.handover_method,
    meetingLocation: row.meeting_location,
    meetingLat: row.meeting_lat,
    meetingLng: row.meeting_lng,
    meetingPlaceId: row.meeting_place_id,
    meetingAt: row.meeting_at,
    deliveryDetails: row.delivery_details,
    deliveryCostCents: row.delivery_cost_cents,
  };
}

function handoverToColumns(handover: ProposalHandoverTerms) {
  return {
    handover_method: handover.handoverMethod,
    meeting_location: handover.meetingLocation,
    meeting_lat: handover.meetingLat,
    meeting_lng: handover.meetingLng,
    meeting_place_id: handover.meetingPlaceId,
    meeting_at: handover.meetingAt,
    delivery_details: handover.deliveryDetails,
    delivery_cost_cents: handover.deliveryCostCents,
  };
}

/** Map a persisted row to the domain record. */
function toProposal(row: ProposalRow): TradeProposalRecord {
  return {
    id: row.id,
    proposerId: row.proposer_id,
    counterpartId: row.counterpart_id,
    proposerItemId: row.proposer_item_id,
    extraItemIds: (row.trade_proposal_items ?? []).map((entry) => entry.item_id),
    counterpartItemId: row.counterpart_item_id,
    cashAmountCents: row.cash_amount_cents ?? 0,
    cashDirection: row.cash_direction,
    declaredValueCents: row.declared_value_cents ?? null,
    status: row.status,
    message: row.message,
    tradeId: row.trade_id,
    handover: handoverFromRow(row),
  };
}

/**
 * Build a {@link TradeProposalRequestRepository} backed by Supabase.
 *
 * Column mapping (see `supabase/migrations/0014_trade_proposals.sql`):
 * - items:           `id`, `owner_id`, `fmv_cents`, `status`, `hidden`
 * - trade_proposals: as listed in {@link PROPOSAL_COLUMNS}
 */
export function createSupabaseTradeProposalRequestRepository(
  client: AdminClient = createAdminClient(),
): TradeProposalRequestRepository {
  return {
    async getItem(itemId: string): Promise<ProposalItemRecord | null> {
      const { data } = await client
        .from('items')
        .select('id, owner_id, fmv_cents, status, hidden')
        .eq('id', itemId)
        .maybeSingle();
      if (!data) return null;
      const row = data as {
        id: string;
        owner_id: string;
        fmv_cents: number;
        status: ProposalItemRecord['status'];
        hidden: boolean | null;
      };
      return {
        id: row.id,
        ownerId: row.owner_id,
        fmvCents: row.fmv_cents,
        status: row.status,
        hidden: row.hidden ?? false,
      };
    },

    async getProposal(proposalId: string): Promise<TradeProposalRecord | null> {
      const { data } = await client
        .from('trade_proposals')
        .select(PROPOSAL_COLUMNS)
        .eq('id', proposalId)
        .maybeSingle();
      return data ? toProposal(data as ProposalRow) : null;
    },

    async hasPendingProposal(
      proposerId: string,
      counterpartItemId: string,
    ): Promise<boolean> {
      const { data } = await client
        .from('trade_proposals')
        .select('id')
        .eq('proposer_id', proposerId)
        .eq('counterpart_item_id', counterpartItemId)
        .eq('status', 'PENDING')
        .maybeSingle();
      return Boolean(data);
    },

    async createProposal(
      params: CreateProposalParams,
    ): Promise<TradeProposalRecord> {
      const handover = params.handover ?? EMPTY_PROPOSAL_HANDOVER;
      const { data, error } = await client
        .from('trade_proposals')
        .insert({
          proposer_id: params.proposerId,
          counterpart_id: params.counterpartId,
          proposer_item_id: params.proposerItemId,
          counterpart_item_id: params.counterpartItemId,
          cash_amount_cents: params.cashAmountCents ?? 0,
          cash_direction: params.cashDirection ?? 'PROPOSER_PAYS',
          declared_value_cents: params.declaredValueCents ?? null,
          message: params.message,
          status: 'PENDING',
          ...handoverToColumns(handover),
        })
        .select(PROPOSAL_COLUMNS)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create trade proposal');
      }

      const extraItemIds = params.extraItemIds ?? [];
      if (extraItemIds.length > 0) {
        const { error: bundleError } = await client
          .from('trade_proposal_items')
          .insert(
            extraItemIds.map((itemId) => ({
              proposal_id: (data as ProposalRow).id,
              item_id: itemId,
            })),
          );
        if (bundleError) {
          // A proposal missing part of its bundle would misrepresent the offer,
          // so remove it rather than leave a half-recorded one pending.
          await client.from('trade_proposals').delete().eq('id', (data as ProposalRow).id);
          throw new Error(bundleError.message);
        }
      }

      return {
        ...toProposal(data as ProposalRow),
        extraItemIds,
      };
    },

    async closeProposal(
      proposalId: string,
      status: Exclude<TradeProposalStatus, 'PENDING' | 'ACCEPTED'>,
    ): Promise<TradeProposalRecord | null> {
      // Re-guard on PENDING so two concurrent decisions cannot both win.
      const { data } = await client
        .from('trade_proposals')
        .update({ status, responded_at: new Date().toISOString() })
        .eq('id', proposalId)
        .eq('status', 'PENDING')
        .select(PROPOSAL_COLUMNS)
        .maybeSingle();
      return data ? toProposal(data as ProposalRow) : null;
    },

    async updateProposalTerms(params: {
      proposalId: string;
      extraItemIds: string[];
      cashAmountCents: number;
      cashDirection: TradeCashDirection;
      declaredValueCents: number | null;
      message: string | null;
      handover: ProposalHandoverTerms;
    }): Promise<TradeProposalRecord | null> {
      // Re-guard on PENDING so an offer cannot be edited after it is answered.
      const { data } = await client
        .from('trade_proposals')
        .update({
          cash_amount_cents: params.cashAmountCents,
          cash_direction: params.cashDirection,
          declared_value_cents: params.declaredValueCents,
          message: params.message,
          ...handoverToColumns(params.handover),
        })
        .eq('id', params.proposalId)
        .eq('status', 'PENDING')
        .select(PROPOSAL_COLUMNS)
        .maybeSingle();
      if (!data) return null;

      // Replace the bundle wholesale: the edit states the full set, not a delta.
      await client
        .from('trade_proposal_items')
        .delete()
        .eq('proposal_id', params.proposalId);
      if (params.extraItemIds.length > 0) {
        const { error } = await client.from('trade_proposal_items').insert(
          params.extraItemIds.map((itemId) => ({
            proposal_id: params.proposalId,
            item_id: itemId,
          })),
        );
        if (error) throw new Error(error.message);
      }

      return { ...toProposal(data as ProposalRow), extraItemIds: params.extraItemIds };
    },

    async markAccepted(
      proposalId: string,
      tradeId: string,
    ): Promise<TradeProposalRecord | null> {
      const { data } = await client
        .from('trade_proposals')
        .update({
          status: 'ACCEPTED',
          trade_id: tradeId,
          responded_at: new Date().toISOString(),
        })
        .eq('id', proposalId)
        .eq('status', 'PENDING')
        .select(PROPOSAL_COLUMNS)
        .maybeSingle();
      return data ? toProposal(data as ProposalRow) : null;
    },
  };
}

/** Default repository for server callers. */
export function createDefaultTradeProposalRequestRepository(): TradeProposalRequestRepository {
  return createSupabaseTradeProposalRequestRepository();
}
