// lib/trades/holdExpiryReestimate.ts
//
// Re-reads the real expiry of live holds that still carry the old seven-day planning
// figure (R4-M5, ESC-17a).
//
// Migration 0133 FLAGS those rows (`expires_at_estimated = true`) and deliberately does
// not rewrite `expires_at` itself: an estimate written blind at deploy time could land
// in the past and have the `:27` lapse job mark a still-live authorisation EXPIRED
// before anyone tried to save it. This pass, first in the `:17` job and before the
// custody sweep reads `expires_at`, asks the provider:
//
//   * the provider's `capture_before`, when it reports one, is written verbatim;
//   * otherwise `max(created_at + 114h, now + 7h)` (`reestimatedExpiry`), so the custody
//     sweep always gets at least one attempt before the lapse job can see the row.
//
// A provider read that THROWS is treated as "reported nothing" and logged: re-trying
// next hour with a floor of `now + 7h` would push the expiry forward every hour and the
// custody sweep would never reach it. The estimate errs early, which is the harmless
// direction; `StripeService.fullCapture`'s retrieve-first guard turns a genuinely dead
// authorisation into a logged CUSTODY_CAPTURE_FAILED rather than a silent stamp.
//
// `server-only`; the store and the payment lookup are injectable for tests.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import type { PaymentService } from '@/domain/services/types';
import { reestimatedExpiry } from '@/domain/dispute/custodyEscalation';
import { regionForCurrency } from '@/lib/regionBinding';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

/** One flagged hold. */
export interface EstimatedHold {
  holdRef: string;
  tradeId: string;
  createdAt: string;
  currency: string;
}

/** Data access for the pass. */
export interface HoldExpiryStore {
  listEstimated(limit: number): Promise<EstimatedHold[]>;
  /** Write the expiry and clear the flag. Throws on a database error. */
  writeExpiry(params: { holdRef: string; expiresAt: string }): Promise<void>;
}

export interface HoldExpiryReestimateResult {
  considered: number;
  fromProvider: number;
  estimated: number;
  failed: number;
}

const MAX_HOLDS_PER_PASS = 200;

/** The production store over the admin client. */
export function createHoldExpiryStore(client = createAdminClient()): HoldExpiryStore {
  return {
    async listEstimated(limit) {
      const { data, error } = await client
        .from('pre_auth_holds')
        .select('hold_ref, trade_id, created_at')
        .eq('status', 'ACTIVE')
        .eq('expires_at_estimated', true)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`[hold expiry] list: ${error.message}`);
      const rows = ((data ?? []) as Array<{ hold_ref: string | null; trade_id: string; created_at: string }>).filter(
        (row) => row.hold_ref,
      );
      if (rows.length === 0) return [];
      const tradeIds = [...new Set(rows.map((row) => row.trade_id))];
      const { data: trades, error: tradeError } = await client.from('trades').select('id, currency').in('id', tradeIds);
      if (tradeError) throw new Error(`[hold expiry] trades: ${tradeError.message}`);
      const currencyOf = new Map(
        ((trades ?? []) as Array<{ id: string; currency: string | null }>).map((t) => [t.id, t.currency ?? 'aud']),
      );
      return rows.map((row) => ({
        holdRef: row.hold_ref as string,
        tradeId: row.trade_id,
        createdAt: row.created_at,
        currency: currencyOf.get(row.trade_id) ?? 'aud',
      }));
    },

    async writeExpiry({ holdRef, expiresAt }) {
      const { error } = await client
        .from('pre_auth_holds')
        .update({ expires_at: expiresAt, expires_at_estimated: false })
        .eq('hold_ref', holdRef)
        .eq('status', 'ACTIVE');
      if (error) throw new Error(`[hold expiry] write: ${error.message}`);
    },
  };
}

/** Run one pass. Never throws per hold. */
export async function reestimateHoldExpiries(
  deps: {
    store?: HoldExpiryStore;
    paymentsFor?: (currency: string) => PaymentService;
    now?: () => Date;
  } = {},
): Promise<HoldExpiryReestimateResult> {
  const store = deps.store ?? createHoldExpiryStore();
  const paymentsFor = deps.paymentsFor ?? ((currency: string) => getPaymentService(regionForCurrency(currency)));
  const now = deps.now ?? (() => new Date());
  const result: HoldExpiryReestimateResult = { considered: 0, fromProvider: 0, estimated: 0, failed: 0 };

  for (const hold of await store.listEstimated(MAX_HOLDS_PER_PASS)) {
    result.considered += 1;
    try {
      const payments = paymentsFor(hold.currency);
      let providerExpiresAt: string | null = null;
      if (payments.readHoldExpiry) {
        try {
          providerExpiresAt = (await payments.readHoldExpiry(hold.holdRef)).expiresAt;
        } catch (error) {
          await logBackgroundFailure({
            name: 'collateral.expiry_readback',
            errorCode: 'PROVIDER_READ_FAILED',
            error,
            context: { tradeId: hold.tradeId },
          });
        }
      }
      const expiresAt = reestimatedExpiry({ createdAt: hold.createdAt, providerExpiresAt, now: now() });
      await store.writeExpiry({ holdRef: hold.holdRef, expiresAt });
      if (providerExpiresAt) result.fromProvider += 1;
      else result.estimated += 1;
    } catch (error) {
      result.failed += 1;
      await logBackgroundFailure({
        name: 'collateral.expiry_reestimate',
        errorCode: 'WRITE_FAILED',
        error,
        context: { tradeId: hold.tradeId },
      });
    }
  }
  return result;
}
