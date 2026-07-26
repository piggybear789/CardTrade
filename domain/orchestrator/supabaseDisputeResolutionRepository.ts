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
  buildEvidencePackPdf,
  evidencePackStoragePath,
  type EvidencePackDocument,
  type EvidencePackGenerator,
  type EvidencePackInput,
} from './evidencePack';
import {
  createDisputeResolutionOrchestrator,
  type DisputeHold,
  type DisputeResolutionDeps,
  type DisputeResolutionOrchestrator,
  type DisputeResolutionRepository,
} from './disputeResolution';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/** Supabase Storage bucket holding generated Police_Evidence_Pack PDFs. */
export const EVIDENCE_PACK_BUCKET = 'evidence-packs';

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

    async getTraderPayerId(traderId: string): Promise<string | null> {
      const { data } = await client
        .from('profiles')
        .select('payer_id')
        .eq('id', traderId)
        .maybeSingle();
      const row = data as { payer_id: string | null } | null;
      return row?.payer_id ?? null;
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

    async recordEvidencePack(params): Promise<void> {
      await client
        .from('trades')
        .update({
          evidence_pack_path: params.storagePath,
          evidence_pack_complete: params.complete,
        })
        .eq('id', params.tradeId);
    },
  };
}

/**
 * Build a Storage-backed {@link EvidencePackGenerator}: it reuses the pure
 * {@link buildEvidencePackPdf} builder and uploads the resulting bytes to the
 * `evidence-packs` Supabase Storage bucket, returning the stored path (Req 8.4).
 */
export function createSupabaseEvidencePackGenerator(
  client: AdminClient = createAdminClient(),
): EvidencePackGenerator {
  return {
    async generate(input: EvidencePackInput): Promise<EvidencePackDocument> {
      const bytes = buildEvidencePackPdf(input);
      const storagePath = evidencePackStoragePath(input.tradeId);
      await client.storage.from(EVIDENCE_PACK_BUCKET).upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
      return { storagePath, bytes, byteLength: bytes.byteLength };
    },
  };
}

/**
 * Default production dispute/fraud resolution orchestrator: a Supabase-backed
 * repository + Storage-backed evidence-pack generator, with the caller supplying
 * the bound Trade Orchestrator, the payment service, and the KYC service.
 *
 * Callers may override any dependency (e.g. inject a fake repository in an
 * integration test).
 */
export function createDefaultDisputeResolutionOrchestrator(
  deps: Pick<DisputeResolutionDeps, 'orchestrator' | 'payments' | 'kyc'> &
    Partial<DisputeResolutionDeps>,
): DisputeResolutionOrchestrator {
  const client = createAdminClient();
  return createDisputeResolutionOrchestrator({
    orchestrator: deps.orchestrator,
    repository: deps.repository ?? createSupabaseDisputeResolutionRepository(client),
    payments: deps.payments,
    kyc: deps.kyc,
    evidencePack: deps.evidencePack ?? createSupabaseEvidencePackGenerator(client),
    now: deps.now,
    maxFullCaptureAttempts: deps.maxFullCaptureAttempts,
  });
}
