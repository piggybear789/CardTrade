// domain/orchestrator/supabaseCollateralDisbursementRepository.ts
//
// The Supabase binding for the collateral disbursement drain (0133), over the
// service-role admin client. Every write checks the returned `{ error }` and throws
// on one: Supabase reports database errors as values, and a drain that silently
// failed to mark a payout settled would pay it again on the next pass.
//
// Kept out of `collateralDisbursement.ts` so the drain stays importable by the
// domain tests without `server-only`.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import type { MerchantRecord } from './merchantOnboarding';
import type { ReleaseFacts } from '../payouts/releasePolicy';
import {
  MAX_DISBURSEMENT_ATTEMPTS,
  processDueCollateralDisbursements,
  type CollateralDisbursementDeps,
  type CollateralDisbursementPassResult,
  type CollateralDisbursementRepository,
  type CollateralDisbursementRow,
  type DisbursementNotifier,
} from './collateralDisbursement';

type AdminClient = ReturnType<typeof createAdminClient>;

interface DisbursementDbRow {
  id: string;
  trade_id: string;
  hold_ref: string;
  kind: CollateralDisbursementRow['kind'];
  payee_id: string | null;
  amount_minor: number;
  currency: string;
  nonce: string;
  status: CollateralDisbursementRow['status'];
  release_at: string | null;
  hold_reason: string | null;
  attempts: number;
  last_error: string | null;
  failure_notified_at: string | null;
  created_at: string;
}

function toRow(row: DisbursementDbRow): CollateralDisbursementRow {
  return {
    id: row.id,
    tradeId: row.trade_id,
    holdRef: row.hold_ref,
    kind: row.kind,
    payeeId: row.payee_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    nonce: row.nonce,
    status: row.status,
    releaseAt: row.release_at,
    holdReason: row.hold_reason,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error,
    failureNotifiedAt: row.failure_notified_at,
    createdAt: row.created_at,
  };
}

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`[collateral disbursement] ${what}: ${error.message}`);
}

/** Build the repository over the admin client. */
export function createSupabaseCollateralDisbursementRepository(
  client: AdminClient = createAdminClient(),
): CollateralDisbursementRepository {
  return {
    async listDue({ now, currency, limit }) {
      const { data, error } = await client
        .from('collateral_disbursements')
        .select(
          'id, trade_id, hold_ref, kind, payee_id, amount_minor, currency, nonce, status, release_at, hold_reason, attempts, last_error, failure_notified_at, created_at',
        )
        .in('status', ['PENDING', 'FAILED'])
        .eq('currency', currency.toLowerCase())
        .is('hold_reason', null)
        .lt('attempts', MAX_DISBURSEMENT_ATTEMPTS)
        .or(`release_at.is.null,release_at.lte.${now.toISOString()}`)
        .order('created_at', { ascending: true })
        .limit(limit);
      check(error, 'listDue');
      return ((data ?? []) as DisbursementDbRow[]).map(toRow);
    },

    async loadReleaseFacts(row): Promise<ReleaseFacts> {
      // The capture instant: the custody stamp when the backstop took the hold, and
      // otherwise the moment the resolution queued this row, which is when it
      // captured. Never earlier than the real capture, so the holdback never shrinks.
      const { data, error } = await client
        .from('pre_auth_holds')
        .select('custody_captured_at')
        .eq('hold_ref', row.holdRef)
        .maybeSingle();
      check(error, 'loadReleaseFacts');
      const custody = (data as { custody_captured_at: string | null } | null)?.custody_captured_at ?? null;
      return {
        source: 'CAPTURED_COLLATERAL',
        currency: row.currency,
        // Not read for CAPTURED_COLLATERAL; the new-seller rule is for earned money.
        qualifyingCompletedSales: 0,
        paymentSettledAt: null,
        capturedAt: custody ?? row.createdAt,
        openChargeDispute: row.holdReason === 'CHARGE_DISPUTE',
        openFraudWarning: row.holdReason === 'FRAUD_WARNING',
        staffHold: row.holdReason === 'STAFF',
      };
    },

    async getPayee(payeeId): Promise<MerchantRecord | null> {
      const { data, error } = await client
        .from('profiles')
        .select(
          'merchant_ref, merchant_status, merchant_settlements_enabled, merchant_live_enabled, merchant_transactions_enabled, fraud_banned_at',
        )
        .eq('id', payeeId)
        .maybeSingle();
      check(error, 'getPayee');
      const row = data as {
        merchant_ref: string | null;
        merchant_status: MerchantRecord['merchantStatus'] | null;
        merchant_settlements_enabled: boolean | null;
        merchant_live_enabled: boolean | null;
        merchant_transactions_enabled: boolean | null;
        fraud_banned_at: string | null;
      } | null;
      if (!row) return null;
      // `fraud_banned_at` is a payout fact `canReceiveFunds` reads; omitting it would
      // pass the ban check silently and pay a banned account.
      return {
        profileId: payeeId,
        merchantRef: row.merchant_ref,
        merchantStatus: row.merchant_status ?? 'NONE',
        liveEnabled: Boolean(row.merchant_live_enabled),
        transactionsEnabled: Boolean(row.merchant_transactions_enabled),
        settlementsEnabled: Boolean(row.merchant_settlements_enabled),
        fraudBannedAt: row.fraud_banned_at,
      };
    },

    async markSettled({ id, providerRef, at }) {
      const { error } = await client
        .from('collateral_disbursements')
        .update({
          status: 'SETTLED',
          provider_ref: providerRef,
          settled_at: at.toISOString(),
          last_error: null,
          updated_at: at.toISOString(),
        })
        .eq('id', id);
      check(error, 'markSettled');
    },

    async markFailed({ id, error: code, countAttempt }) {
      let attempts: number | undefined;
      if (countAttempt) {
        const { data, error } = await client
          .from('collateral_disbursements')
          .select('attempts')
          .eq('id', id)
          .maybeSingle();
        check(error, 'markFailed read');
        attempts = Number((data as { attempts: number } | null)?.attempts ?? 0) + 1;
      }
      const { error } = await client
        .from('collateral_disbursements')
        .update({
          status: 'FAILED',
          last_error: code,
          ...(attempts !== undefined ? { attempts } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      check(error, 'markFailed');
    },

    async recordDeferral({ id, releaseAt, holdReason }) {
      const { error } = await client
        .from('collateral_disbursements')
        .update({ release_at: releaseAt, hold_reason: holdReason, updated_at: new Date().toISOString() })
        .eq('id', id);
      check(error, 'recordDeferral');
    },

    async markFailureNotified({ id, at }) {
      const { error } = await client
        .from('collateral_disbursements')
        .update({ failure_notified_at: at.toISOString() })
        .eq('id', id);
      check(error, 'markFailureNotified');
    },
  };
}

/** The production notifier: one in-app notice, linked to the trade room. */
export function createDisbursementNotifier(): DisbursementNotifier {
  return {
    async payoutFailed({ payeeId, tradeId, cause }) {
      await createNotification({
        userId: payeeId,
        type: 'TRADE',
        title: cause === 'NOT_PAYABLE' ? 'Payout on hold — finish your payout setup' : 'Payout delayed',
        body:
          cause === 'NOT_PAYABLE'
            ? 'Support decided a trade dispute in your favour. We are holding what you are owed ' +
              'because your payout setup is not finished. Complete it and we will release it automatically.'
            : 'What you are owed from a trade dispute could not be sent yet. We are retrying ' +
              'automatically and it stays held for you.',
        link: cause === 'NOT_PAYABLE' ? '/profile/payouts' : `/trades/${tradeId}`,
      });
    },
  };
}

/** Run one drain pass for a region's currency with the production bindings. */
export function createDefaultCollateralDisbursementDrain(
  deps: Pick<CollateralDisbursementDeps, 'payments' | 'currency'> &
    Partial<Omit<CollateralDisbursementDeps, 'payments' | 'currency'>>,
): { run(): Promise<CollateralDisbursementPassResult> } {
  const repository = deps.repository ?? createSupabaseCollateralDisbursementRepository();
  return {
    run: () =>
      processDueCollateralDisbursements({
        ...deps,
        repository,
        notifier: deps.notifier ?? createDisbursementNotifier(),
      }),
  };
}
