// lib/trades/completion.ts
//
// What a Trade owes once it reaches COMPLETED, by whichever route got it there.
//
// WHY THIS IS ITS OWN MODULE. This logic used to sit inline in `recordLifecycle`,
// reachable only from a mutual acceptance. Adding the inspection timeout gave
// COMPLETED a second route, and a second route that forgot to release collateral
// would leave both traders' cards authorised indefinitely — the exact failure the
// timeout exists to prevent. Sharing one implementation is what makes "the timeout
// does the same thing an acceptance does" a fact rather than an intention.
//
// It also cannot live in `lib/actions/trades.ts`: that module is `'use server'`, and
// a `'use server'` module may only export async functions, every one of which
// becomes an endpoint addressable by anyone who learns its id. None of this belongs
// on the public surface.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { regionForCurrency, regionForTrade } from '@/lib/regionBinding';
import { canReceiveFunds } from '@/domain/orchestrator/merchantOnboarding';
import { createSupabaseMerchantRepository } from '@/domain/orchestrator/supabaseMerchantRepository';
import type { Tables } from '@/lib/supabase/database.types';

/** The full persisted Trade row shape. */
export type TradeRow = Tables<'trades'>;

/**
 * Void every ACTIVE Pre_Auth_Hold on a completed Trade at $0 cost.
 *
 * Best-effort: a void failure does not roll back COMPLETED — the goods have already
 * changed hands — but it is logged so it can be chased. The same tolerance the
 * dispute and fraud paths apply to their own void calls.
 */
export async function voidTradeHolds(tradeId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: holds } = await admin
    .from('pre_auth_holds')
    .select('hold_ref, status')
    .eq('trade_id', tradeId);
  // Bound to the trade's own platform account (0068). A PaymentIntent belongs to the
  // account that created it, so cancelling one through a different region's client
  // fails with "no such payment_intent" — which would leave real collateral held on a
  // completed trade until the authorisation lapsed.
  const payments = getPaymentService(await regionForTrade(tradeId));
  for (const hold of holds ?? []) {
    if (hold.status !== 'ACTIVE') continue;
    if (!hold.hold_ref) continue;
    try {
      const voided = await payments.voidHold(hold.hold_ref as string);
      await admin
        .from('pre_auth_holds')
        .update({ status: voided.status })
        .eq('hold_ref', hold.hold_ref as string);
    } catch (err) {
      console.warn(`[trades] failed to void hold ${hold.hold_ref} on completion:`, err);
    }
  }
}

/** Outcome of attempting to settle a trade's cash leg. */
export type SettleTradeCashResult =
  | { ok: true }
  | { ok: false; error: 'not-ready' | 'transfer-failed'; detail?: string };

/**
 * Settle a completed Trade's cash leg. `cash_direction` identifies who pays.
 *
 * Cash terms may be agreed before the receiver has finished payout setup;
 * settlement then waits and flags the trade for reconciliation until they can take
 * funds, or a participant retries.
 *
 * Failure does not block COMPLETED: the goods have already changed hands.
 */
export async function settleTradeCash(trade: TradeRow): Promise<SettleTradeCashResult> {
  const admin = createAdminClient();
  const payerProfileId =
    trade.cash_direction === 'COUNTERPART_PAYS' ? trade.counterpart_id : trade.initiator_id;
  const receiverProfileId =
    trade.cash_direction === 'COUNTERPART_PAYS' ? trade.initiator_id : trade.counterpart_id;

  const [{ data: payer }, receiver] = await Promise.all([
    admin.from('profiles').select('id, payer_id').eq('id', payerProfileId).maybeSingle(),
    createSupabaseMerchantRepository(admin).loadMerchant(receiverProfileId),
  ]);

  const payerId = payer?.payer_id as string | null;
  const merchantRef = receiver?.merchantRef ?? null;

  if (!payerId || !canReceiveFunds(receiver) || !merchantRef) {
    await admin.from('trades').update({ manual_reconciliation: true }).eq('id', trade.id);
    console.warn(
      `[trades] cash settlement for trade ${trade.id} could not be started: ` +
        'payer or payout account missing.',
    );
    return { ok: false, error: 'not-ready' };
  }

  // The trade's own platform account: both traders are in one region by the contract
  // guard, so there is exactly one, and it is the only account that can pay this
  // receiver's connected account.
  const payments = getPaymentService(regionForCurrency(trade.currency));
  try {
    const transfer = await payments.requestTransfer({
      payerId,
      amount: trade.cash_amount_cents,
      ref: `trade-cash:${trade.id}`,
      // Reused verbatim on retry, never regenerated, so a repeat cannot double-pay.
      nonce: `trade-cash:${trade.id}`,
      merchantRef,
    });
    if (transfer.status !== 'SETTLED') {
      await admin.from('trades').update({ manual_reconciliation: true }).eq('id', trade.id);
      console.warn(`[trades] cash settlement for trade ${trade.id} failed to settle.`);
      return { ok: false, error: 'transfer-failed' };
    }
    await admin.from('trades').update({ manual_reconciliation: false }).eq('id', trade.id);
    return { ok: true };
  } catch (err) {
    await admin.from('trades').update({ manual_reconciliation: true }).eq('id', trade.id);
    console.warn(`[trades] cash settlement for trade ${trade.id} threw:`, err);
    return {
      ok: false,
      error: 'transfer-failed',
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

/**
 * Everything a Trade owes on reaching COMPLETED: release both collateral
 * authorisations, then settle any cash leg.
 *
 * Called from the mutual-acceptance path AND from the inspection-timeout sweep, so
 * the two cannot drift.
 */
export async function finalizeCompletedTrade(trade: TradeRow): Promise<void> {
  await voidTradeHolds(trade.id);
  if ((trade.cash_amount_cents ?? 0) > 0) {
    await settleTradeCash(trade);
  }
}
