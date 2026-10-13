// domain/orchestrator/supabaseTradeCashSettlementRepository.ts
//
// The Supabase binding for a trade's cash leg (0139, ESC-05/06), over the service-role
// admin client. Every write is guarded on the expected status and checks the returned
// `{ error }`: Supabase reports database errors as values, and a release that silently
// failed to record RELEASED would pay the receiver again on the next pass.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables, TradeCashSettlementStatus } from '@/lib/supabase/database.types';
import { canReceiveFunds } from './merchantOnboarding';
import { relatedBuyers } from '@/lib/risk/signals';
import { createSupabaseMerchantRepository } from './supabaseMerchantRepository';
import { countQualifyingSales, type CompletedSaleFact, type ReleaseFacts } from '../payouts/releasePolicy';
import {
  computePayBy,
  type TradeCashPatch,
  type TradeCashSettlementDeps,
  type TradeCashSettlementRecord,
  type TradeCashSettlementRepository,
} from './tradeCashSettlement';
import type { PaymentService } from '../services/types';

type AdminClient = ReturnType<typeof createAdminClient>;
type Row = Tables<'trade_cash_settlements'>;

function toRecord(row: Row): TradeCashSettlementRecord {
  return {
    tradeId: row.trade_id,
    payerId: row.payer_id,
    receiverId: row.receiver_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    collectionAttempt: Number(row.collection_attempt ?? 0),
    collectionRef: row.collection_ref,
    collectionRequestedAt: row.collection_requested_at,
    collectedAt: row.collected_at,
    payBy: row.pay_by,
    releaseNonce: row.release_nonce,
    refundNonce: row.refund_nonce,
    holdReason: row.hold_reason,
    cancelFailures: Number(row.cancel_failures ?? 0),
    attempts: Number(row.attempts ?? 0),
  };
}

function toColumns(patch: TradeCashPatch = {}): Partial<Row> {
  const out: Partial<Row> = {};
  if (patch.collectionAttempt !== undefined) out.collection_attempt = patch.collectionAttempt;
  if (patch.collectionRef !== undefined) out.collection_ref = patch.collectionRef;
  if (patch.collectionRequestedAt !== undefined) out.collection_requested_at = patch.collectionRequestedAt;
  if (patch.collectedAt !== undefined) out.collected_at = patch.collectedAt;
  if (patch.releaseNonce !== undefined) out.release_nonce = patch.releaseNonce;
  if (patch.refundNonce !== undefined) out.refund_nonce = patch.refundNonce;
  if (patch.cancelFailures !== undefined) out.cancel_failures = patch.cancelFailures;
  if (patch.attempts !== undefined) out.attempts = patch.attempts;
  if (patch.releaseRef !== undefined) out.release_ref = patch.releaseRef;
  if (patch.refundRef !== undefined) out.refund_ref = patch.refundRef;
  if (patch.releaseAt !== undefined) out.release_at = patch.releaseAt;
  if (patch.lastError !== undefined) out.last_error = patch.lastError;
  return out;
}

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`[trade cash] ${what}: ${error.message}`);
}

export function createSupabaseTradeCashSettlementRepository(
  client: AdminClient = createAdminClient(),
): TradeCashSettlementRepository {
  return {
    async load(tradeId) {
      const { data, error } = await client
        .from('trade_cash_settlements')
        .select('*')
        .eq('trade_id', tradeId)
        .maybeSingle();
      check(error, 'load');
      return data ? toRecord(data as Row) : null;
    },

    async loadTrade(tradeId) {
      const { data, error } = await client
        .from('trades')
        .select('id, state, meeting_at')
        .eq('id', tradeId)
        .maybeSingle();
      check(error, 'loadTrade');
      if (!data) return null;
      const row = data as { id: string; state: string; meeting_at: string | null };
      return { id: row.id, state: String(row.state), meetingAt: row.meeting_at };
    },

    async transition(tradeId, from, to, patch) {
      const { data, error } = await client
        .from('trade_cash_settlements')
        .update({ ...toColumns(patch), status: to })
        .eq('trade_id', tradeId)
        .in('status', from)
        .select('*')
        .maybeSingle();
      check(error, `transition ${from.join('|')} -> ${to}`);
      return data ? toRecord(data as Row) : null;
    },

    async patch(tradeId, status, patch) {
      const { data, error } = await client
        .from('trade_cash_settlements')
        .update(toColumns(patch))
        .eq('trade_id', tradeId)
        .eq('status', status)
        .select('*')
        .maybeSingle();
      check(error, 'patch');
      return data ? toRecord(data as Row) : null;
    },

    async loadPayerRef(profileId) {
      const { data, error } = await client
        .from('profiles')
        .select('payer_id, payment_source_id')
        .eq('id', profileId)
        .maybeSingle();
      check(error, 'loadPayerRef');
      const row = data as { payer_id: string | null; payment_source_id: string | null } | null;
      return row?.payer_id && row.payment_source_id ? row.payer_id : null;
    },

    async loadReceiverPayout(profileId) {
      const merchant = await createSupabaseMerchantRepository(client).loadMerchant(profileId);
      return {
        merchantRef: merchant?.merchantRef ?? null,
        payable: canReceiveFunds(merchant),
      };
    },

    async countCompletedPurchases(profileId) {
      const { count, error } = await client
        .from('cash_sales')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', profileId)
        .eq('status', 'COMPLETED');
      // A failed read counts as new: the safe direction is a 3-D Secure check.
      return error ? 0 : (count ?? 0);
    },

    async listByStatus(status, limit, opts) {
      let query = client.from('trade_cash_settlements').select('*').eq('status', status);
      // Eligibility BEFORE the limit, so held or future rows cannot starve the drain.
      if (opts?.currency) query = query.eq('currency', opts.currency.toLowerCase());
      if (opts?.dueBy) {
        query = query.is('hold_reason', null).or(`release_at.is.null,release_at.lte.${opts.dueBy}`);
      }
      const { data, error } = await query.order('updated_at', { ascending: true }).limit(limit);
      check(error, `listByStatus ${status}`);
      return ((data ?? []) as Row[]).map(toRecord);
    },

    async listCollectingBefore(before, limit, currency) {
      let query = client
        .from('trade_cash_settlements')
        .select('*')
        .eq('status', 'COLLECTING')
        .lt('collection_requested_at', before);
      if (currency) query = query.eq('currency', currency.toLowerCase());
      const { data, error } = await query.order('collection_requested_at', { ascending: true }).limit(limit);
      check(error, 'listCollectingBefore');
      return ((data ?? []) as Row[]).map(toRecord);
    },

    async loadReleaseFacts(record): Promise<ReleaseFacts> {
      // The same holdback a seller's cash sale gets (ESC-03): trade cash is money the
      // receiver EARNED, so a new account waits, and an open chargeback holds it.
      const { data: completed, error } = await client
        .from('cash_sales')
        .select('id, buyer_id, agreed_price_cents, currency, payment_settled_at')
        .eq('seller_id', record.receiverId)
        .eq('status', 'COMPLETED')
        .limit(200);
      check(error, 'loadReleaseFacts history');
      const ids = (completed ?? []).map((row) => row.id as string);
      const { data: saleDisputes, error: saleDisputeError } = ids.length
        ? await client.from('charge_disputes').select('cash_sale_id').in('cash_sale_id', ids)
        : { data: [], error: null };
      check(saleDisputeError, 'loadReleaseFacts sale disputes');
      const disputed = new Set((saleDisputes ?? []).map((row) => row.cash_sale_id as string));
      // ESC-03 layer 3: a sale to a related buyer never counts.
      const related = await relatedBuyers(record.receiverId, (completed ?? []).map((row) => row.buyer_id as string), client);
      const facts: CompletedSaleFact[] = (completed ?? [])
        .filter((row) => row.payment_settled_at)
        .map((row) => ({
          buyerId: row.buyer_id as string,
          agreedPriceMinor: Number(row.agreed_price_cents ?? 0),
          currency: String(row.currency ?? 'aud'),
          paymentSettledAt: row.payment_settled_at as string,
          chargeDisputed: disputed.has(row.id as string),
          buyerRelated: related.has(row.buyer_id as string),
        }));
      const { data: openDisputes, error: openError } = await client
        .from('charge_disputes')
        .select('id')
        .eq('trade_id', record.tradeId)
        .is('closed_at', null)
        .limit(1);
      check(openError, 'loadReleaseFacts trade disputes');
      return {
        source: 'TRADE_CASH',
        currency: record.currency,
        qualifyingCompletedSales: countQualifyingSales(facts, new Date()),
        paymentSettledAt: record.collectedAt,
        openChargeDispute: (openDisputes ?? []).length > 0 || record.holdReason === 'CHARGE_DISPUTE',
        openFraudWarning: record.holdReason === 'FRAUD_WARNING',
        staffHold: record.holdReason === 'STAFF',
      };
    },
  };
}

/** The deps for the trade cash functions, bound to one region's payment service. */
export function createDefaultTradeCashDeps(payments: PaymentService): TradeCashSettlementDeps {
  return { repository: createSupabaseTradeCashSettlementRepository(), payments };
}

/**
 * Create the cash-leg row at TERMS_AGREED (ESC-05). Idempotent: an existing row is
 * left exactly as it is, so a retried acceptance can never reset a collected leg.
 * Returns false (and the caller logs) when the write fails.
 */
export async function ensureTradeCashSettlement(
  trade: Pick<
    Tables<'trades'>,
    'id' | 'initiator_id' | 'counterpart_id' | 'cash_amount_cents' | 'cash_direction' | 'currency' | 'meeting_at'
  >,
  client: AdminClient = createAdminClient(),
  agreedAt: Date = new Date(),
): Promise<boolean> {
  const amount = Number(trade.cash_amount_cents ?? 0);
  if (amount <= 0) return true;
  const payerId = trade.cash_direction === 'COUNTERPART_PAYS' ? trade.counterpart_id : trade.initiator_id;
  const receiverId = trade.cash_direction === 'COUNTERPART_PAYS' ? trade.initiator_id : trade.counterpart_id;
  const { error } = await client.from('trade_cash_settlements').upsert(
    {
      trade_id: trade.id,
      payer_id: payerId,
      receiver_id: receiverId,
      amount_minor: amount,
      currency: String(trade.currency ?? 'aud'),
      status: 'NOT_COLLECTED' as TradeCashSettlementStatus,
      pay_by: computePayBy({ meetingAt: trade.meeting_at, agreedAt }).toISOString(),
    },
    { onConflict: 'trade_id', ignoreDuplicates: true },
  );
  return !error;
}
