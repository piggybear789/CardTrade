import 'server-only';

// lib/actions/tradeFees.ts
//
// Collecting and returning the Trade_Fee. Not a Server Action module: nothing here
// is callable from a client. The fee is charged by `acceptTradeTerms` at the
// Commitment_Point and returned by the cancellation path, both server-side.
//
// ORDER OF OPERATIONS. The fee rows are written BEFORE the provider is called, so
// a charge that succeeds while the response is lost leaves a PENDING row carrying
// the nonce that a retry reuses. Writing the row afterwards would mean an
// ambiguous timeout charged a trader with nothing on file to prove it.
//
// The bond is never the fee's source — see `domain/trade/tradeFee.ts`.

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { regionForTrade } from '@/lib/regionBinding';
import {
  resolveTradeFees,
  isTradeFeeRefundable,
  type TradeFeeStatus,
} from '@/domain/trade/tradeFee';
import type { Tables } from '@/lib/supabase/database.types';

type TradeFeeRow = Tables<'trade_fees'>;

/** Deterministic idempotency key for one trader's fee on one trade. */
function feeNonce(tradeId: string, traderId: string): string {
  return `tradefee:${tradeId}:${traderId}`;
}

export interface TradeFeeOutcome {
  /** Fees that settled, in cents, summed across both traders. */
  collectedCents: number;
  /** True when at least one trader's fee could not be collected. */
  anyFailed: boolean;
}

/**
 * Charge both traders their fee for an agreed trade.
 *
 * Never throws and never blocks the trade. A fee that fails is recorded FAILED for
 * the drain job to retry: refusing to let an agreed exchange proceed because the
 * platform could not take its cut would punish the traders for our collection
 * problem, and the goods are the point of the contract.
 */
export async function chargeTradeFees(params: {
  tradeId: string;
  initiatorId: string;
  counterpartId: string;
  /** Value the INITIATOR receives, in cents (the counterpart's bundle plus any cash to them). */
  initiatorReceivesCents: number;
  /** Value the COUNTERPART receives, in cents. */
  counterpartReceivesCents: number;
}): Promise<TradeFeeOutcome> {
  const admin = createAdminClient();
  // Fees are charged against the traders' saved cards, which are Customers on the
  // trade's own platform account (0068). Charging through another region's client
  // would not find the payer at all.
  const payments = getPaymentService(await regionForTrade(params.tradeId));

  const { initiatorFeeCents, counterpartFeeCents } = resolveTradeFees({
    initiatorReceivesCents: params.initiatorReceivesCents,
    counterpartReceivesCents: params.counterpartReceivesCents,
  });

  const owed = [
    { traderId: params.initiatorId, amountCents: initiatorFeeCents },
    { traderId: params.counterpartId, amountCents: counterpartFeeCents },
  ].filter((entry) => entry.amountCents > 0);

  let collectedCents = 0;
  let anyFailed = false;

  for (const entry of owed) {
    const nonce = feeNonce(params.tradeId, entry.traderId);

    // Idempotent by construction: the primary key is (trade_id, trader_id), so a
    // replay updates the amount rather than inserting a second obligation.
    await admin.from('trade_fees').upsert(
      {
        trade_id: params.tradeId,
        trader_id: entry.traderId,
        amount_cents: entry.amountCents,
        nonce,
        status: 'PENDING',
      },
      { onConflict: 'trade_id,trader_id' },
    );

    const { data: payerRow } = await admin
      .from('profiles')
      .select('payer_id')
      .eq('id', entry.traderId)
      .maybeSingle();
    const payerId = (payerRow?.payer_id as string | null) ?? null;

    if (!payerId) {
      anyFailed = true;
      await recordFeeResult(params.tradeId, entry.traderId, 'FAILED', {
        error: 'No payment instrument on file.',
      });
      continue;
    }

    // No `merchantRef`: the fee is collected into the PLATFORM balance, which is
    // exactly what omitting it means. Passing one would forward our own cut to a
    // connected account.
    const result = await payments.requestTransfer({
      payerId,
      amount: entry.amountCents,
      ref: `tradefee:${params.tradeId}`,
      nonce,
    });

    if (result.status === 'SETTLED') {
      collectedCents += entry.amountCents;
      await recordFeeResult(params.tradeId, entry.traderId, 'SETTLED', {
        chargeRef: result.transferId,
      });
    } else {
      anyFailed = true;
      await recordFeeResult(params.tradeId, entry.traderId, 'FAILED', {
        chargeRef: result.transferId,
        error: 'The provider declined the fee charge.',
      });
    }
  }

  return { collectedCents, anyFailed };
}

/** Persist the outcome of one fee attempt, counting attempts so a stuck fee is visible. */
async function recordFeeResult(
  tradeId: string,
  traderId: string,
  status: TradeFeeStatus,
  extra: { chargeRef?: string | null; refundRef?: string | null; error?: string } = {},
): Promise<void> {
  const admin = createAdminClient();
  const { data: current } = await admin
    .from('trade_fees')
    .select('attempts')
    .eq('trade_id', tradeId)
    .eq('trader_id', traderId)
    .maybeSingle();

  await admin
    .from('trade_fees')
    .update({
      status,
      ...(extra.chargeRef ? { charge_ref: extra.chargeRef } : {}),
      ...(extra.refundRef ? { refund_ref: extra.refundRef } : {}),
      ...(status === 'SETTLED'
        ? { settled_at: new Date().toISOString(), error: null }
        : {}),
      ...(status === 'REFUNDED' ? { refunded_at: new Date().toISOString() } : {}),
      ...(extra.error ? { error: extra.error } : {}),
      attempts: Number(current?.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('trade_id', tradeId)
    .eq('trader_id', traderId);
}

/**
 * Return every collected fee on a trade.
 *
 * Called when an agreed trade does not proceed — collateral could not be arranged,
 * or the exchange was cancelled before the goods moved. Only a SETTLED fee is
 * refunded: a PENDING one took nothing and a FAILED one took nothing, so refunding
 * either would spend the platform's own money.
 */
export async function refundTradeFees(tradeId: string): Promise<number> {
  const admin = createAdminClient();
  // A refund acts on a charge that belongs to one platform account (0068), so it has
  // to be issued through the same one that took the fee.
  const payments = getPaymentService(await regionForTrade(tradeId));

  const { data } = await admin
    .from('trade_fees')
    .select('*')
    .eq('trade_id', tradeId);

  let refundedCents = 0;
  for (const row of (data ?? []) as TradeFeeRow[]) {
    if (!isTradeFeeRefundable(row.status) || !row.charge_ref) continue;

    const refund = await payments.refundPayment({
      paymentRef: row.charge_ref,
      amount: row.amount_cents,
      // Distinct from the charge nonce: a refund is a different operation on the
      // same collection, and reusing the charge key would make the provider treat
      // it as a replay of the charge.
      nonce: `${row.nonce}:refund`,
    });

    if (refund.status === 'SETTLED') {
      refundedCents += row.amount_cents;
      await recordFeeResult(tradeId, row.trader_id, 'REFUNDED', {
        refundRef: refund.refundId,
      });
    } else {
      await recordFeeResult(tradeId, row.trader_id, 'SETTLED', {
        error: 'The fee refund was declined and is still owed back.',
      });
    }
  }
  return refundedCents;
}

// ---------------------------------------------------------------------------
// Retry drain
// ---------------------------------------------------------------------------

/**
 * Attempts allowed on one trader's fee before it stops being retried.
 *
 * Bounded for the same reason the Cash_Sale payout drain is: eight tries on an hourly
 * schedule keeps every retry inside the provider's 24-hour idempotency-key window, so
 * a retry can only ever REPLAY the original charge rather than create a second one.
 * Past that the row stays FAILED for an operator, which is the honest outcome.
 */
const MAX_FEE_ATTEMPTS = 8;

/** How many fee rows one pass will attempt. */
const MAX_FEES_PER_PASS = 25;

/** Outcome of one fee-retry pass. */
export interface TradeFeeDrainResult {
  /** Rows attempted this pass. */
  attempted: number;
  /** Rows that settled. */
  settled: number;
  /** Rows that failed again and remain owed. */
  stillFailed: number;
  /** Rows that have exhausted `MAX_FEE_ATTEMPTS` and are left for an operator. */
  exhausted: number;
  /** True when more rows were eligible than one pass handles. */
  moreDue: boolean;
}

/**
 * Retry Trade_Fees that failed to collect.
 *
 * THIS IS THE DRAIN `chargeTradeFees` ALREADY CLAIMED TO HAVE. Its doc-comment said a
 * failed fee "is recorded FAILED for the drain job to retry", and nothing anywhere
 * read those rows: `trade_fees` was touched only by the charge and refund functions in
 * this module, both of which run once at the Commitment_Point and at cancellation. So
 * every fee that failed — a declined card, a momentary provider error, a trader with no
 * instrument on file at that instant — was silently uncollected revenue forever.
 *
 * REUSES THE PERSISTED NONCE VERBATIM, never a fresh one. That is what makes a retry
 * safe: if the original charge actually succeeded and only the response was lost, the
 * provider replays it instead of taking the money twice.
 *
 * Never throws. Per-row isolation, because one trader's dead card must not stop the
 * queue — the same lesson as the inspection sweep.
 */
export async function drainFailedTradeFees(
  limit = MAX_FEES_PER_PASS,
): Promise<TradeFeeDrainResult> {
  const admin = createAdminClient();
  const bounded = Math.max(1, Math.min(limit, 200));
  const result: TradeFeeDrainResult = {
    attempted: 0,
    settled: 0,
    stillFailed: 0,
    exhausted: 0,
    moreDue: false,
  };

  const { data } = await admin
    .from('trade_fees')
    .select('*')
    .eq('status', 'FAILED')
    .lt('attempts', MAX_FEE_ATTEMPTS)
    // Oldest first, so a persistently failing row cannot starve the rest.
    .order('updated_at', { ascending: true })
    .limit(bounded + 1);

  const rows = (data ?? []) as TradeFeeRow[];
  result.moreDue = rows.length > bounded;

  for (const row of rows.slice(0, bounded)) {
    try {
      result.attempted += 1;

      const { data: payerRow } = await admin
        .from('profiles')
        .select('payer_id')
        .eq('id', row.trader_id)
        .maybeSingle();
      const payerId = (payerRow?.payer_id as string | null) ?? null;

      if (!payerId) {
        result.stillFailed += 1;
        await recordFeeResult(row.trade_id, row.trader_id, 'FAILED', {
          error: 'No payment instrument on file.',
        });
        continue;
      }

      const payments = getPaymentService(await regionForTrade(row.trade_id));
      const charge = await payments.requestTransfer({
        payerId,
        amount: row.amount_cents,
        ref: `tradefee:${row.trade_id}`,
        // The persisted key, reused exactly.
        nonce: row.nonce,
      });

      if (charge.status === 'SETTLED') {
        result.settled += 1;
        await recordFeeResult(row.trade_id, row.trader_id, 'SETTLED', {
          chargeRef: charge.transferId,
        });
      } else {
        result.stillFailed += 1;
        await recordFeeResult(row.trade_id, row.trader_id, 'FAILED', {
          chargeRef: charge.transferId,
          error: 'The provider declined the fee charge.',
        });
      }
    } catch (err) {
      result.stillFailed += 1;
      console.warn(
        `[tradeFees] retry failed for trade ${row.trade_id} trader ${row.trader_id}:`,
        err,
      );
    }
  }

  const { count } = await admin
    .from('trade_fees')
    .select('trade_id', { count: 'exact', head: true })
    .eq('status', 'FAILED')
    .gte('attempts', MAX_FEE_ATTEMPTS);
  result.exhausted = count ?? 0;

  return result;
}
