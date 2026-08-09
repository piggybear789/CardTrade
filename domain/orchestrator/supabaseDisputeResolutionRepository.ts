// domain/orchestrator/supabaseDisputeResolutionRepository.ts
//
// The concrete, production wiring of the dispute/fraud resolution seams, backed
// by the service-role Supabase admin client (which bypasses RLS — resolution
// must mutate the Trade and its holds via this trusted path). Mirrors
// `supabaseTradeRepository.ts` / `supabaseTradeProposalRepository.ts`.
//
// This binding is kept OUT of `disputeResolution.ts` on purpose: that
// coordination module must stay importable by the domain tests (in-memory fakes)
// without pulling in `server-only`/Supabase. Only this file carries the
// server-only dependency.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PreAuthHold } from '../services/types';
import {
  createDisputeResolutionOrchestrator,
  type DisputeHold,
  type DisputeResolutionDeps,
  type DisputeResolutionOrchestrator,
  type DisputeResolutionRepository,
} from './disputeResolution';
import type { MerchantRecord } from './merchantOnboarding';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Build a {@link DisputeResolutionRepository} backed by the Supabase admin
 * client.
 *
 * Column mapping (see `supabase/migrations/0001_schema.sql` + `0004_dispute_fraud.sql`):
 * - trades: `dispute_raised_by`, `disputed_against`, `disputed_at`,
 *   `fraud_victim_id`, `friction_tax_return_cents`, `friction_tax_platform_cents`,
 *   `partial_capture_failed`, `return_overdue`, `full_capture_failed`,
 *   `manual_reconciliation`, `evidence_pack_path`, `evidence_pack_complete`
 * - pre_auth_holds: `trader_id`, `hold_ref`, `amount_cents`, `captured_cents`, `status`
 * - profiles: `payer_id`
 */
export function createSupabaseDisputeResolutionRepository(
  client: AdminClient = createAdminClient(),
): DisputeResolutionRepository {
  return {
    async getHolds(tradeId: string): Promise<DisputeHold[]> {
      const { data } = await client
        .from('pre_auth_holds')
        .select('trader_id, hold_ref, amount_cents, captured_cents, status')
        .eq('trade_id', tradeId);
      const rows = (data ?? []) as Array<{
        trader_id: string;
        hold_ref: string;
        amount_cents: number;
        captured_cents: number;
        status: PreAuthHold['status'];
      }>;
      return rows.map((row) => ({
        traderId: row.trader_id,
        holdRef: row.hold_ref,
        amountCents: Number(row.amount_cents),
        capturedCents: Number(row.captured_cents),
        status: row.status,
      }));
    },

    async getTraderPayee(traderId: string): Promise<MerchantRecord | null> {
      // The victim's PAYOUT destination, not their card. Reading `payer_id` here
      // was what let the fraud path charge the victim — see the interface comment.
      const { data } = await client
        .from('profiles')
        .select(
          'merchant_ref, merchant_status, merchant_settlements_enabled, merchant_live_enabled, merchant_transactions_enabled',
        )
        .eq('id', traderId)
        .maybeSingle();
      const row = data as {
        merchant_ref: string | null;
        merchant_status: MerchantRecord['merchantStatus'] | null;
        merchant_settlements_enabled: boolean | null;
        merchant_live_enabled: boolean | null;
        merchant_transactions_enabled: boolean | null;
      } | null;
      if (!row) return null;
      // Only the payout facts are read. Identity fields are deliberately absent:
      // `canReceiveFunds` does not consult them, and this module holds no identity
      // data by design (see the module header).
      return {
        profileId: traderId,
        merchantRef: row.merchant_ref,
        merchantStatus: row.merchant_status ?? 'NONE',
        liveEnabled: Boolean(row.merchant_live_enabled),
        transactionsEnabled: Boolean(row.merchant_transactions_enabled),
        settlementsEnabled: Boolean(row.merchant_settlements_enabled),
      };
    },

    async recordDisputeParticipants(params): Promise<void> {
      await client
        .from('trades')
        .update({
          dispute_raised_by: params.raisedBy,
          disputed_against: params.disputedAgainst,
          disputed_at: params.at.toISOString(),
        })
        .eq('id', params.tradeId);
    },

    async recordFrictionTaxCapture(params): Promise<void> {
      // Increment the disputed-against hold's captured amount and mark it
      // PARTIALLY_CAPTURED (Req 7.2), then store the $10/$10 allocation on the
      // Trade (Req 7.3).
      const { data } = await client
        .from('pre_auth_holds')
        .select('captured_cents')
        .eq('hold_ref', params.holdRef)
        .maybeSingle();
      const prior = Number((data as { captured_cents: number } | null)?.captured_cents ?? 0);
      await client
        .from('pre_auth_holds')
        .update({
          captured_cents: prior + params.capturedCents,
          status: 'PARTIALLY_CAPTURED',
        })
        .eq('hold_ref', params.holdRef);
      await client
        .from('trades')
        .update({
          friction_tax_return_cents: params.allocation.returnShippingCents,
          friction_tax_platform_cents: params.allocation.platformFeeCents,
        })
        .eq('id', params.tradeId);
    },

    async recordPartialCaptureFailure(params): Promise<void> {
      await client
        .from('trades')
        .update({ partial_capture_failed: true })
        .eq('id', params.tradeId);
    },

    async recordFrictionTaxReturnResult(params): Promise<void> {
      // Columns from 0075. `paid_at` staying NULL is what marks the share as still owed,
      // so it is only ever set on a settled payout.
      await client
        .from('trades')
        .update({
          friction_tax_return_nonce: params.nonce,
          friction_tax_return_paid_at: params.paid ? new Date().toISOString() : null,
          friction_tax_return_error: params.paid ? null : (params.error ?? null),
        })
        .eq('id', params.tradeId);
    },

    async recordReturnOverdue(params): Promise<void> {
      await client.from('trades').update({ return_overdue: true }).eq('id', params.tradeId);
    },

    async markHoldVoided(holdRef: string): Promise<void> {
      await client.from('pre_auth_holds').update({ status: 'VOIDED' }).eq('hold_ref', holdRef);
    },

    async recordFraudParticipants(params): Promise<void> {
      await client
        .from('trades')
        .update({ fraud_victim_id: params.victimId })
        .eq('id', params.tradeId);
    },

    async recordFullCapture(params): Promise<void> {
      await client
        .from('pre_auth_holds')
        .update({ captured_cents: params.capturedCents, status: 'FULLY_CAPTURED' })
        .eq('hold_ref', params.holdRef);
    },

    async flagManualReconciliation(params): Promise<void> {
      await client
        .from('trades')
        .update({ full_capture_failed: true, manual_reconciliation: true })
        .eq('id', params.tradeId);
    },

  };
}

/**
 * Default production dispute/fraud resolution orchestrator: a Supabase-backed
 * repository, with the caller supplying the bound Trade Orchestrator and the
 * payment service.
 *
 * Takes no KYC dependency: the identity-disclosure step this flow used to perform
 * has been removed, so no verified identity field is read.
 *
 * Callers may override any dependency (e.g. inject a fake repository in an
 * integration test).
 */
export function createDefaultDisputeResolutionOrchestrator(
  deps: Pick<DisputeResolutionDeps, 'orchestrator' | 'payments'> &
    Partial<DisputeResolutionDeps>,
): DisputeResolutionOrchestrator {
  const client = createAdminClient();
  return createDisputeResolutionOrchestrator({
    orchestrator: deps.orchestrator,
    repository: deps.repository ?? createSupabaseDisputeResolutionRepository(client),
    payments: deps.payments,
    now: deps.now,
    maxFullCaptureAttempts: deps.maxFullCaptureAttempts,
  });
}
