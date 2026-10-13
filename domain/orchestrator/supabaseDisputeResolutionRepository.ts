// domain/orchestrator/supabaseDisputeResolutionRepository.ts
//
// The production binding of the dispute seams over the service-role admin client
// (which bypasses RLS: a resolution must mutate the trade and its holds through the
// trusted path). Mirrors `supabaseTradeRepository.ts`.
//
// Every write checks the returned `{ error }` and throws on one. Supabase reports a
// database error as a value, not an exception, and a resolution that believed it had
// stamped a capture or queued a payout when it had not would leave money unaccounted
// for.
//
// Kept OUT of `disputeResolution.ts` so that module stays importable by the domain
// tests without `server-only`.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PaymentService } from '../services/types';
import {
  createDisputeResolutionOrchestrator,
  type DisputeHold,
  type DisputeResolutionDeps,
  type DisputeResolutionOrchestrator,
  type DisputeResolutionRepository,
} from './disputeResolution';
import type { TradeRecord, TradeOrchestrator } from './tradeOrchestrator';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`[dispute repository] ${what}: ${error.message}`);
}

/**
 * Build a {@link DisputeResolutionRepository} over the admin client.
 *
 * Columns: trades (0004 dispute columns, 0046 fraud claim, 0075 return share, 0083
 * reason, 0133 outcome / custody / attestation), pre_auth_holds (0133 custody),
 * collateral_disbursements (0133), profiles.unfounded_dispute_count (0133).
 */
export function createSupabaseDisputeResolutionRepository(
  client: AdminClient = createAdminClient(),
): DisputeResolutionRepository {
  return {
    async loadTrade(tradeId): Promise<TradeRecord | null> {
      const { data, error } = await client.from('trades').select('*').eq('id', tradeId).maybeSingle();
      check(error, 'loadTrade');
      return (data as TradeRecord | null) ?? null;
    },

    async getHolds(tradeId: string): Promise<DisputeHold[]> {
      // Oldest first, so `currentLiveHold` (ESC-07) reads each trader's attempts in
      // the order they were made; a FAILED first attempt must never be "the" hold.
      const { data, error } = await client
        .from('pre_auth_holds')
        .select('trader_id, hold_ref, amount_cents, captured_cents, status, created_at, custody_captured_at')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });
      check(error, 'getHolds');
      const rows = (data ?? []) as Array<{
        trader_id: string;
        hold_ref: string | null;
        amount_cents: number;
        captured_cents: number;
        status: DisputeHold['status'];
        created_at: string | null;
        custody_captured_at: string | null;
      }>;
      return rows
        .filter((row) => typeof row.hold_ref === 'string' && row.hold_ref.length > 0)
        .map((row) => ({
          traderId: row.trader_id,
          holdRef: row.hold_ref as string,
          amountCents: Number(row.amount_cents),
          capturedCents: Number(row.captured_cents),
          status: row.status,
          createdAt: row.created_at,
          custodyCapturedAt: row.custody_captured_at,
        }));
    },

    async hasReachedInspection(tradeId): Promise<boolean> {
      // R4-M1: the deadline column is written by the same trigger that fires on
      // entering INSPECTION, so it proves the history even if the audit row was lost.
      const { data: trade, error: tradeError } = await client
        .from('trades')
        .select('inspection_deadline_at')
        .eq('id', tradeId)
        .maybeSingle();
      check(tradeError, 'hasReachedInspection trade');
      if ((trade as { inspection_deadline_at: string | null } | null)?.inspection_deadline_at) return true;

      const { data, error } = await client
        .from('trade_state_transitions')
        .select('id')
        .eq('trade_id', tradeId)
        .eq('to_state', 'INSPECTION')
        .limit(1);
      check(error, 'hasReachedInspection history');
      return (data ?? []).length > 0;
    },

    async disbursedFromHold(holdRef) {
      const { data, error } = await client
        .from('collateral_disbursements')
        .select('amount_minor, status')
        .eq('hold_ref', holdRef);
      check(error, 'disbursedFromHold');
      let settledCents = 0;
      let queuedCents = 0;
      for (const row of (data ?? []) as Array<{ amount_minor: number; status: string }>) {
        if (row.status === 'SETTLED') settledCents += Number(row.amount_minor);
        else queuedCents += Number(row.amount_minor);
      }
      return { settledCents, queuedCents };
    },

    async recordDisputeParticipants(params): Promise<void> {
      const { error } = await client
        .from('trades')
        .update({
          dispute_raised_by: params.raisedBy,
          disputed_against: params.disputedAgainst,
          disputed_at: params.at.toISOString(),
          // Written only when supplied (0083), so a later claim on an already-disputed
          // trade cannot blank the reason the first one recorded.
          ...(params.reason ? { dispute_reason: params.reason } : {}),
        })
        .eq('id', params.tradeId);
      check(error, 'recordDisputeParticipants');
    },

    async recordFraudClaim(params): Promise<boolean> {
      // 0046's RPC: participant-checked, INSPECTION/DISPUTED only, first claim wins.
      const { data, error } = await client.rpc('record_trade_fraud_claim', {
        p_trade_id: params.tradeId,
        p_claimant_id: params.claimantId,
        p_reason: params.reason,
      });
      check(error, 'recordFraudClaim');
      return Boolean(data);
    },

    async recordHoldCapture(params): Promise<void> {
      const { error } = await client
        .from('pre_auth_holds')
        .update({
          captured_cents: params.capturedCents,
          status: params.status,
          custody_captured_at: params.custodyCapturedAt.toISOString(),
        })
        .eq('hold_ref', params.holdRef);
      check(error, 'recordHoldCapture');
    },

    async markHoldVoided(holdRef: string): Promise<void> {
      const { error } = await client.from('pre_auth_holds').update({ status: 'VOIDED' }).eq('hold_ref', holdRef);
      check(error, 'markHoldVoided');
    },

    async queueDisbursements(rows): Promise<void> {
      if (rows.length === 0) return;
      // Idempotent on the deterministic nonce: a retried resolution queues nothing twice.
      const { error } = await client.from('collateral_disbursements').upsert(
        rows.map((row) => ({
          trade_id: row.tradeId,
          hold_ref: row.holdRef,
          kind: row.kind,
          payee_id: row.payeeId,
          amount_minor: row.amountMinor,
          currency: row.currency,
          nonce: row.nonce,
          hold_reason: row.holdReason ?? null,
        })),
        { onConflict: 'nonce', ignoreDuplicates: true },
      );
      check(error, 'queueDisbursements');
    },

    async insertCustodyAudit(params): Promise<void> {
      const { error } = await client.from('trade_state_transitions').insert({
        trade_id: params.tradeId,
        from_state: 'DISPUTED',
        to_state: 'DISPUTED',
        requested_by: params.actorId,
        event: 'COLLATERAL_TAKEN_INTO_CUSTODY',
        created_at: params.at.toISOString(),
      });
      check(error, 'insertCustodyAudit');
    },

    async recordOutcome(params): Promise<void> {
      const { error } = await client
        .from('trades')
        .update({
          dispute_outcome: params.outcome,
          dispute_goods_exchanged_attested_by: params.attestedBy,
          dispute_goods_exchanged_attested_at: params.attestedBy ? params.at.toISOString() : null,
          ...(params.cancelled ? { cancelled_at: params.at.toISOString() } : {}),
        })
        .eq('id', params.tradeId);
      check(error, 'recordOutcome');
    },

    async recordFraudParticipants(params): Promise<void> {
      const { error } = await client
        .from('trades')
        .update({ fraud_victim_id: params.victimId })
        .eq('id', params.tradeId);
      check(error, 'recordFraudParticipants');
    },

    async incrementUnfoundedDisputeCount(profileId): Promise<void> {
      const { data, error: readError } = await client
        .from('profiles')
        .select('unfounded_dispute_count')
        .eq('id', profileId)
        .maybeSingle();
      check(readError, 'incrementUnfoundedDisputeCount read');
      const current = Number((data as { unfounded_dispute_count: number } | null)?.unfounded_dispute_count ?? 0);
      const { error } = await client
        .from('profiles')
        .update({ unfounded_dispute_count: current + 1 })
        .eq('id', profileId);
      check(error, 'incrementUnfoundedDisputeCount');
    },

    async flagManualReconciliation(params): Promise<void> {
      const { error } = await client
        .from('trades')
        .update({
          manual_reconciliation: true,
          ...(params.fullCaptureFailed ? { full_capture_failed: true } : {}),
        })
        .eq('id', params.tradeId);
      check(error, 'flagManualReconciliation');
    },

    async restoreTradeItemsIfUnclaimed(tradeId): Promise<string[]> {
      const { data, error } = await client.rpc('restore_trade_items_if_unclaimed', { p_trade_id: tradeId });
      check(error, 'restoreTradeItemsIfUnclaimed');
      return ((data ?? []) as string[]).filter((id) => typeof id === 'string');
    },
  };
}

/**
 * The production dispute coordinator: the Supabase repository, with the caller
 * supplying the trade orchestrator, the payment service and the lib-side bindings
 * (cash leg, fee refund, notifier). Any dependency may be overridden.
 */
export function createDefaultDisputeResolutionOrchestrator(
  deps: { orchestrator: TradeOrchestrator; payments: PaymentService } & Partial<DisputeResolutionDeps>,
): DisputeResolutionOrchestrator {
  return createDisputeResolutionOrchestrator({
    ...deps,
    repository: deps.repository ?? createSupabaseDisputeResolutionRepository(createAdminClient()),
  });
}
