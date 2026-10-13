'use server';

// lib/actions/admin.ts
//
// Server Actions for the admin / moderation console (Phase 6).
//
// SECURITY MODEL (critical): admin authorization is NEVER trusted from the
// client. Every mutating action here first re-reads `profiles.is_admin` for the
// current `auth.uid()` via the cookie-bound client (which RLS scopes to the
// caller's own profile). Only after confirming the caller is an admin does it
// reach for the SERVICE-ROLE admin client to perform cross-user moderation
// writes (hiding items, updating report status across users, clearing trade
// reconciliation flags). The service-role client is import-guarded by
// `server-only` and is only ever used inside these server actions.
//
// ONE DELIBERATE EXCEPTION. The dispute-resolution actions
// (`resolveCashSaleDispute`, `resolveTradeDispute`, `setDisputeCustodyScope`,
// `resolveTrackingFlag`) gate on `requireStaff` rather than `requireAdmin`, because arbitration is the support
// worker's job and does not need the power to hide listings or drain payout queues.
// They still never trust the client, and an admin passes that gate too. Everything
// else in this module is admin-only.
//
// Every export is an async Server Action; shared shapes are `export type` only.

import { withActionLog } from '@/lib/errors/withActionLog';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeAvatarObject } from '@/lib/storage/profileImages';
import { permanentlyBanConfirmedFraudOffender } from '@/lib/auth/fraudBan';
import { requireStaff } from '@/lib/staffGate';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import type { CashSaleDisputeOutcome, TrackingFlagDecision } from '@/domain/orchestrator/cashSaleOrchestrator';
import { CASH_SALE_INSPECTION_DAYS } from '@/domain/fulfilment/inspection';
import { createLoggedDisputeOrchestrator } from '@/lib/trades/disputeOrchestrator';
import type { TradeDisputeOutcome } from '@/domain/orchestrator/disputeResolution';
import { regionForProfile, regionForTrade } from '@/lib/regionBinding';
import { applyIdentityDecision } from '@/lib/identity/applyIdentityDecision';
import {
  COLLECTED_SALE_STATUSES,
  reconcileCustody,
  type CustodyPosition,
  type HeldSaleInput,
  type HeldCollateralInput,
  type HeldTradeCashInput,
} from '@/domain/payouts/custodyReconciliation';
import { getPaymentService, operationalRegions } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { normalizeRegionCode, regionCurrency } from '@/domain/region';
import type { Enums } from '@/lib/supabase/database.types';
import { createNotification } from '@/lib/notifications/createNotification';

/**
 * Admin action error codes.
 * - `not-authenticated` — no signed-in user.
 * - `not-authorized`    — the caller is not an admin.
 * - `not-found`         — the target row does not exist.
 * - `persistence-error` — the database write failed.
 */
export type AdminActionError =
  | 'not-authenticated'
  | 'not-authorized'
  | 'not-found'
  | 'persistence-error'
  /** A staff input failed validation; `field` names it. */
  | 'invalid-input'
  /** ESC-24: the duplicate-of account is still live; close it first. */
  | 'duplicate-still-live'
  /** ESC-24: the duplicate-of account was banned for fraud; never approved. */
  | 'duplicate-banned';

/** Discriminated result returned by every admin action. */
export type AdminActionResult<T = { id: string }> =
  | { ok: true; data: T }
  | { ok: false; error: AdminActionError; message?: string; field?: string };

/**
 * Build the dispute coordinator for one trade, on the trade's own platform account.
 *
 * A resolution captures and voids authorisations, which belong to the Stripe account
 * that created them (0068), so the region comes from the trade.
 */
async function buildAdminDisputeOrchestrator(tradeId: string) {
  return createLoggedDisputeOrchestrator(await regionForTrade(tradeId));
}

/**
 * Re-verify that the current caller is an authenticated admin, server-side.
 * Returns the admin's user id on success or a typed failure otherwise. This is
 * the single authorization gate every mutating admin action MUST pass before
 * touching the service-role client.
 */
async function requireAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: AdminActionError }
> {
  const user = await getCachedAuthUser();

  if (!user) {
    return { ok: false, error: 'not-authenticated' };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    return { ok: false, error: 'not-authorized' };
  }

  return { ok: true, adminId: user.id };
}

/** Set an item's `hidden` flag via the service-role client (admin-gated). */
async function setItemHidden(
  itemId: string,
  hidden: boolean,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('items')
    .update({ hidden })
    .eq('id', itemId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  return { ok: true, data: { id: data.id } };
}

/** Hide a listing (removes it from the public catalog). Admin-only. */
export const hideItem = withActionLog('admin.hideItem', async function hideItem(itemId: string): Promise<AdminActionResult> {
  return setItemHidden(itemId, true);
});

/** Un-hide a listing (restores it to the public catalog). Admin-only. */
export const unhideItem = withActionLog('admin.unhideItem', async function unhideItem(itemId: string): Promise<AdminActionResult> {
  return setItemHidden(itemId, false);
});

/**
 * Clear a member's avatar. Admin-only (0066).
 *
 * WHY THIS EXISTS AT ALL. An avatar is a member-supplied image rendered beside
 * their name on the catalog, in chat, and in a contract room where money is at
 * stake — so it is an abuse surface, and it is the one part of the avatar feature
 * that needed a staff remedy before it shipped. Reports already cover listings
 * (`hideItem`) and there was no equivalent for a picture.
 *
 * CLEARS, rather than hides. There is no `avatar_hidden` flag and deliberately so:
 * a second column would be another piece of state to keep in agreement with the
 * first, and the fallback for "no avatar" already exists and is the common case, so
 * nulling the column lands the member on initials with nothing else to maintain.
 *
 * The Storage object is deleted too. Leaving it would keep an offensive image
 * fetchable at a public URL by anyone who had already seen it, which is most of the
 * harm the clear is meant to stop.
 *
 * Service-role, because the column is owner-writable only — an admin is not the
 * owner, so RLS would refuse the cookie-bound client.
 */
export const clearMemberAvatar = withActionLog('admin.clearMemberAvatar', async function clearMemberAvatar(profileId: string): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();

  // Read the outgoing path first: after the update it is unrecoverable, and the
  // object has to be removed as well as dereferenced.
  const { data: before } = await admin
    .from('profiles')
    .select('avatar_path')
    .eq('id', profileId)
    .maybeSingle();

  const { data, error } = await admin
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', profileId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  // Best-effort and after the row is updated: the profile no longer points at the
  // object, so a storage failure leaves an orphan rather than a live avatar.
  await removeAvatarObject(admin, (before?.avatar_path as string | null) ?? null);

  return { ok: true, data: { id: data.id } };
});

/**
 * Set a report's status. `ACTIONED` also stamps `reviewed_by`/`reviewed_at`;
 * `DISMISSED` records the reviewer as well so triage is auditable. Admin-only.
 */
export const setReportStatus = withActionLog('admin.setReportStatus', async function setReportStatus(
  reportId: string,
  status: Extract<Enums<'report_status'>, 'ACTIONED' | 'DISMISSED'>,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('reports')
    .update({
      status,
      reviewed_by: gate.adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reportId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  return { ok: true, data: { id: data.id } };
});

/**
 * Set a feedback row's status (0120). Admin-only, and identical in shape to
 * {@link setReportStatus} because the triage question is identical.
 *
 * ACTIONED vs DISMISSED carries no product behaviour — nothing downstream reads it.
 * It exists so the backlog shrinks as it is worked, which is the only thing that keeps
 * a queue readable, and so "we looked at this and decided not to" is recorded as a
 * decision rather than as an unread row.
 *
 * Writes through the service role: `feedback_admin_update` has no member grant behind
 * it, matching the arrangement `policies.test.ts` records for `reports:UPDATE`.
 */
export const setFeedbackStatus = withActionLog('admin.setFeedbackStatus', async function setFeedbackStatus(
  feedbackId: string,
  status: Extract<Enums<'report_status'>, 'ACTIONED' | 'DISMISSED'>,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('feedback')
    .update({
      status,
      // Both stamps or neither: `feedback_review_stamp_complete` in 0120 rejects a
      // half-filled pair, so they are written together here.
      reviewed_by: gate.adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', feedbackId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  revalidatePath('/admin');
  return { ok: true, data: { id: data.id } };
});

/**
 * Mark every open occurrence of one error group resolved (0123). Admin-only.
 *
 * RESOLVES WHAT EXISTS, NOT WHAT IS COMING. Only rows already recorded are stamped, so
 * an error that recurs after a "fix" arrives unresolved and reopens the group by itself
 * — the queue cannot be emptied by declaring victory over a bug that is still live.
 *
 * Writes through the service role: `error_logs` has no member UPDATE grant or policy,
 * the same arrangement as feedback and reports.
 */
export const resolveErrorGroup = withActionLog('admin.resolveErrorGroup', async function resolveErrorGroup(
  fingerprint: string,
): Promise<AdminActionResult<{ fingerprint: string; resolved: number }>> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (typeof fingerprint !== 'string' || !/^[0-9a-z]{1,32}$/.test(fingerprint)) {
    return { ok: false, error: 'not-found' };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('error_logs')
    .update({ resolved_at: new Date().toISOString(), resolved_by: gate.adminId })
    .eq('fingerprint', fingerprint)
    .is('resolved_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  revalidatePath('/admin');
  return { ok: true, data: { fingerprint, resolved: data?.length ?? 0 } };
});

/**
 * Clear a trade's manual-reconciliation flag once an admin has reviewed the
 * flagged trade. Admin-only.
 */
export const clearTradeReconciliationFlag = withActionLog('admin.clearTradeReconciliationFlag', async function clearTradeReconciliationFlag(
  tradeId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trades')
    .update({ manual_reconciliation: false })
    .eq('id', tradeId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  return { ok: true, data: { id: data.id } };
});

/**
 * Retry the Seller release for one Cash_Sale (Req 4.3), admin-gated.
 *
 * Exists because a failed release means the platform is sitting on money that
 * belongs to a Seller. The hourly drain retries automatically, but an operator
 * who has just fixed the cause (finished the Seller's payout onboarding, say)
 * should not have to wait up to an hour to confirm it worked.
 *
 * Safe to press repeatedly: the release reuses the sale's persisted nonce, so the
 * provider deduplicates rather than paying twice.
 */
export const retryCashSalePayout = withActionLog('admin.retryCashSalePayout', async function retryCashSalePayout(
  cashSaleId: string,
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // Bound to the SALE's own region (0068): the release transfers into the seller's
  // connected account, and a transfer from the wrong platform account is refused by
  // Stripe as a cross-region transfer.
  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.payoutSeller({ cashSaleId });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'CASH_SALE_NOT_FOUND' ? 'not-found' : 'persistence-error',
      message:
        result.error === 'SELLER_NOT_PAYABLE'
          ? 'The seller still cannot receive funds. Their payout onboarding is not approved yet.'
          : (result.detail ?? 'The provider rejected the release.'),
    };
  }

  revalidatePath('/admin');
  return {
    ok: true,
    data: { id: cashSaleId, status: result.sale.sellerPayoutStatus },
  };
});

/**
 * Resolve a disputed Cash_Sale (Req 4.15), STAFF-gated.
 *
 * WHY AN OPERATOR AND NOT AN ALGORITHM. There is no automated arbiter, and the
 * platform is merchant of record and owns loss liability, so a human decides and
 * the decision is recorded against their id. Before this existed a disputed sale
 * had no exit at all: the money stayed in the platform balance indefinitely while
 * the Buyer had been told they would be refunded.
 *
 * WHY `requireStaff` AND NOT `requireAdmin`. Deciding a dispute is the support
 * worker's job. Gating it on `is_admin` would mean every arbitrator also carried the
 * power to hide listings, action community reports and drain the payout queue — a
 * blast radius earned by needing one capability. An admin still passes this gate; a
 * support worker passes it without inheriting moderation.
 *
 * The refund is attempted BEFORE the sale leaves DISPUTED, so a provider refusal
 * leaves a retryable dispute rather than a "resolved" sale whose money never moved.
 */
/**
 * Decide a STALLED return — contested by the seller, or never posted (0088/0089).
 *
 * A separate action from `resolveCashSaleDispute` because it answers a different
 * question: not who was right about the goods, but whether an already-decided refund's
 * condition was met. Staff-gated for the same reason as every other resolution.
 */
export const resolveCashSaleReturnCase = withActionLog('admin.resolveCashSaleReturnCase', async function resolveCashSaleReturnCase(
  cashSaleId: string,
  outcome: 'REFUND_BUYER' | 'RELEASE_SELLER',
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.resolveReturnCase({
    cashSaleId,
    actorId: gate.ctx.userId,
    outcome,
  });

  if (!result.ok) {
    return {
      // The admin surface has its own error vocabulary, so an orchestrator code is
      // reported as a generic failure with a specific MESSAGE rather than leaked
      // through a union it does not belong to.
      ok: false,
      error: 'persistence-error',
      message:
        result.error === 'REFUND_FAILED'
          ? 'The provider refused the refund. It stays queued and can be retried.'
          : result.error === 'INVALID_STATE'
            ? 'That return is not waiting on a decision.'
            : 'That return could not be resolved.',
    };
  }

  revalidatePath('/admin/arbitration');
  revalidatePath(`/sales/${cashSaleId}`);
  return { ok: true, data: { id: result.sale.id, status: result.sale.status } };
});

/**
 * Decide a flagged outbound tracking number (ESC-02), staff-gated.
 *
 * A flag means the tracking cannot be this sale's parcel as recorded: it was
 * delivered before the sale shipped, or it was already delivered when the seller
 * entered it. No inspection clock starts until staff decide:
 *
 * - START_CLOCK  — the delivery is genuine; the buyer's 7-day inspection starts now.
 * - REFUND_BUYER — it is not this parcel; the buyer is refunded in full, no return owed.
 */
export const resolveTrackingFlag = withActionLog('admin.resolveTrackingFlag', async function resolveTrackingFlag(
  cashSaleId: string,
  decision: TrackingFlagDecision,
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.resolveTrackingFlag({
    cashSaleId,
    staffId: gate.ctx.userId,
    decision,
    inspectionDays: CASH_SALE_INSPECTION_DAYS,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'CASH_SALE_NOT_FOUND' ? 'not-found' : 'persistence-error',
      message: result.detail ?? 'The tracking flag could not be resolved.',
    };
  }
  revalidatePath('/admin/arbitration');
  revalidatePath(`/admin/arbitration/CASH_SALE/${cashSaleId}`);
  revalidatePath(`/sales/${cashSaleId}`);
  return { ok: true, data: { id: result.sale.id, status: result.sale.status } };
});

/**
 * Set or clear a seller's open-exposure limit (ESC-03 layer 1).
 *
 * `limitMinor` replaces the per-currency new-seller limit for this seller whatever
 * their history: a higher figure lets a known trader sell a big binder, 0 pauses
 * them. `null` clears it, returning them to the default policy. Staff only; the
 * column has no member grant.
 */
export const setExposureLimitOverride = withActionLog('admin.setExposureLimitOverride', async function setExposureLimitOverride(
  profileId: string,
  limitMinor: number | null,
): Promise<AdminActionResult<{ id: string; limitMinor: number | null }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (limitMinor !== null && (!Number.isSafeInteger(limitMinor) || limitMinor < 0)) {
    return {
      ok: false,
      error: 'invalid-input',
      field: 'limitMinor',
      message: 'Enter a whole amount of zero or more, or clear the override.',
    };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .update({ exposure_limit_override_minor: limitMinor })
    .eq('id', profileId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  revalidatePath('/admin');
  return { ok: true, data: { id: profileId, limitMinor } };
});

/**
 * Decide a member held for a duplicate identity (ESC-24).
 *
 * APPROVE only once the older account is CLOSED (the "lost my old login" case). A
 * live older account is refused (`duplicate-still-live`): close it first. A banned
 * one is refused outright (`duplicate-banned`): that is exactly the evasion the
 * blocklist exists for. Approval goes through the same writer as every identity
 * decision, so the bans and the person keys still apply.
 *
 * REJECT marks the check FAILED and tells the member to contact support.
 */
export const resolveDuplicateIdentity = withActionLog('admin.resolveDuplicateIdentity', async function resolveDuplicateIdentity(
  profileId: string,
  decision: 'APPROVE' | 'REJECT',
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, identity_duplicate_of, identity_check_session_id')
    .eq('id', profileId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!profile?.identity_duplicate_of) return { ok: false, error: 'not-found', message: 'No duplicate review is open for this member.' };

  if (decision === 'REJECT') {
    const { error: rejectError } = await admin
      .from('profiles')
      .update({ identity_check_status: 'FAILED' })
      .eq('id', profileId)
      .neq('identity_check_status', 'VERIFIED');
    if (rejectError) return { ok: false, error: 'persistence-error', message: rejectError.message };
    await createNotification({
      userId: profileId,
      type: 'SYSTEM',
      title: 'Identity check not approved',
      body: "We couldn't approve your identity check. Contact support if you think this is a mistake.",
      link: '/profile?tab=verification',
    });
    revalidatePath('/admin');
    return { ok: true, data: { id: profileId, status: 'FAILED' } };
  }

  const { data: older, error: olderError } = await admin
    .from('profiles')
    .select('id, closed_at, fraud_banned_at')
    .eq('id', profile.identity_duplicate_of as string)
    .maybeSingle();
  if (olderError) return { ok: false, error: 'persistence-error', message: olderError.message };
  if (older?.fraud_banned_at) {
    return { ok: false, error: 'duplicate-banned', message: 'The other account was banned for fraud, so this cannot be approved.' };
  }
  if (older && !older.closed_at) {
    return { ok: false, error: 'duplicate-still-live', message: 'Close the other account first, then approve this one.' };
  }

  const sessionId = profile.identity_check_session_id as string | null;
  const payments = getPaymentService(await regionForProfile(profileId));
  if (!sessionId || !payments.readIdentityCheck) {
    return { ok: false, error: 'persistence-error', message: 'The identity session could not be read back.' };
  }
  const check = await payments.readIdentityCheck(sessionId);
  const applied = await applyIdentityDecision({
    profileId,
    check,
    staffOverride: { staffId: gate.ctx.userId },
  });
  revalidatePath('/admin');
  return { ok: true, data: { id: profileId, status: applied === 'verified' ? 'VERIFIED' : applied.toUpperCase() } };
});

/**
 * Claw a released seller payout back from their connected account (ESC-14).
 *
 * Staff only and NEVER automatic: friendly fraud against an honest seller must not be
 * auto-clawed, so a chargeback alone does nothing to money that has already left.
 * Keyed on the sale, so a retry cannot reverse twice.
 */
export const reverseCashSalePayout = withActionLog('admin.reverseCashSalePayout', async function reverseCashSalePayout(
  cashSaleId: string,
  amountMinor: number,
): Promise<AdminActionResult<{ id: string; reversalRef: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  // WP5 (ESC-36): approval — a second staff member confirms before money moves.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cash_sales')
    .select('id, seller_payout_status, seller_payout_ref, amount_cents, platform_fee_cents, shipping_cost_cents')
    .eq('id', cashSaleId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  if (data.seller_payout_status !== 'SETTLED' || !data.seller_payout_ref) {
    return { ok: false, error: 'invalid-input', message: 'This sale has no released payout to reverse.' };
  }
  const releasedNet = Number(data.amount_cents ?? 0) - Number(data.platform_fee_cents ?? 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > releasedNet) {
    return {
      ok: false,
      error: 'invalid-input',
      field: 'amountMinor',
      message: 'Enter an amount above zero and no more than what the seller was paid.',
    };
  }
  const payments = getPaymentService(await regionForCashSale(cashSaleId));
  if (!payments.reversePayout) {
    return { ok: false, error: 'persistence-error', message: 'The payment provider cannot reverse payouts.' };
  }
  const reversal = await payments.reversePayout({
    transferId: data.seller_payout_ref as string,
    amount: amountMinor,
    nonce: `cash-sale:${cashSaleId}`,
  });
  if (reversal.status !== 'SETTLED') {
    return { ok: false, error: 'persistence-error', message: 'The reversal did not go through.' };
  }
  revalidatePath('/admin');
  return { ok: true, data: { id: cashSaleId, reversalRef: reversal.transferId } };
});

export const resolveCashSaleDispute = withActionLog('admin.resolveCashSaleDispute', async function resolveCashSaleDispute(
  cashSaleId: string,
  outcome: CashSaleDisputeOutcome,
  refundCents?: number,
  /**
   * Override whether a full refund waits on the goods coming back (0088).
   *
   * Left undefined, the orchestrator DERIVES it from the record, which is right
   * almost always. The override exists for the case the record cannot express: a
   * parcel the carrier marked delivered that contained the wrong item, or nothing at
   * all. There is no item to send back, so demanding a return would strand the
   * buyer's money on a condition they cannot satisfy.
   *
   * It is deliberately available in BOTH directions. Forcing a return ON matters when
   * a buyer's "it never arrived" is contradicted by evidence the operator can see and
   * the columns cannot.
   */
  requireReturn?: boolean,
): Promise<AdminActionResult<{ id: string; status: string; refundCents: number }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // A resolution refunds the buyer and/or releases to the seller, so it must run on
  // the platform account that collected the money (0068).
  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.resolveDispute({
    cashSaleId,
    actorId: gate.ctx.userId,
    outcome,
    refundCents,
    requireReturn,
  });

  if (!result.ok) {
    const message =
      result.error === 'INVALID_REFUND_AMOUNT'
        ? 'A partial refund must be more than zero and less than the amount collected.'
        : result.error === 'NOTHING_TO_REFUND'
          ? 'No funds were ever collected for this sale, so there is nothing to refund.'
          : result.error === 'REFUND_FAILED'
            ? 'The provider rejected the refund. The sale is still disputed — you can retry.'
            : result.error === 'INVALID_STATE'
              ? `This sale is ${result.detail ?? 'not disputed'}, so it cannot be resolved.`
              : (result.detail ?? 'The dispute could not be resolved.');

    return {
      ok: false,
      error: result.error === 'CASH_SALE_NOT_FOUND' ? 'not-found' : 'persistence-error',
      message,
    };
  }

  revalidatePath('/admin');
  revalidatePath('/admin/arbitration');
  // The case page the operator is standing on. A resolved case leaves the queue, so
  // without this the page they just acted from would still offer the same buttons.
  revalidatePath(`/admin/arbitration/CASH_SALE/${cashSaleId}`);
  revalidatePath(`/sales/${cashSaleId}`);
  return {
    ok: true,
    data: {
      id: cashSaleId,
      status: result.sale.status,
      refundCents: result.sale.refundCents,
    },
  };
});

/** What a staff trade-dispute decision reports back to the console. */
export type ResolveTradeDisputeActionData = {
  id: string;
  state: string;
  outcome: TradeDisputeOutcome['kind'];
  manualReconciliation: boolean;
};

/**
 * Resolve a disputed Trade with a staff-chosen outcome (design §1.2), staff-gated.
 *
 * Replaces `resolveTradeConditionDispute` and `resolveTradeFraud`. The four outcomes:
 *
 * - UNFOUNDED   — releases both traders' collateral and completes the trade.
 * - CONDITION   — pays the wronged trader up to the accused's remaining collateral
 *                 and completes the trade.
 * - FRAUD       — captures the offender's collateral for the victim (paid after a
 *                 7-day safety hold), bans the offender, and closes the trade.
 * - NO_EXCHANGE — the exchange never happened: releases everything, refunds the
 *                 fees and cancels the trade. Only on a trade that never reached
 *                 INSPECTION.
 *
 * The victim / wronged trader is an ARGUMENT, validated against the trade before any
 * money moves (ESC-23): a refused decision touches nothing. On a never-inspected trade
 * UNFOUNDED and CONDITION need the staff attestation that the goods changed hands.
 */
export const resolveTradeDispute = withActionLog('admin.resolveTradeDispute', async function resolveTradeDispute(
  tradeId: string,
  outcome: TradeDisputeOutcome,
): Promise<AdminActionResult<ResolveTradeDisputeActionData>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const result = await (await buildAdminDisputeOrchestrator(tradeId)).resolveTradeDispute({
    tradeId,
    actorId: gate.ctx.userId,
    outcome,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'TRADE_NOT_FOUND' ? 'not-found' : 'persistence-error',
      message:
        result.error === 'INVALID_OUTCOME'
          ? (result.detail ?? 'That outcome is not available for this trade.')
          : result.error === 'HOLD_NOT_FOUND'
            ? 'The accused trader has no collateral left on this trade. The case is flagged for reconciliation.'
            : result.error === 'CAPTURE_FAILED'
              ? 'The collateral could not be captured. The trade stays disputed and is flagged for reconciliation.'
              : result.error === 'HOLD_RELEASE_FAILED'
                ? 'A temporary card hold could not be released. The trade stays disputed and is flagged for reconciliation.'
                : result.error === 'DISPUTE_HISTORY_UNAVAILABLE'
                  ? "The trade's history could not be read, so nothing was changed. Try again."
                  : (result.detail ?? 'The dispute could not be resolved.'),
    };
  }

  const { resolution } = result;
  const trade = resolution.trade;
  const initiatorId = trade.initiator_id as string;
  const counterpartId = trade.counterpart_id as string;

  revalidatePath('/admin');
  revalidatePath('/admin/arbitration');
  revalidatePath(`/admin/arbitration/TRADE/${tradeId}`);
  revalidatePath(`/trades/${tradeId}`);

  if (outcome.kind === 'FRAUD' && resolution.offendingTraderId) {
    const ban = await permanentlyBanConfirmedFraudOffender({
      offenderId: resolution.offendingTraderId,
      staffId: gate.ctx.userId,
      tradeId,
    });
    if (!ban.ok) {
      // FRAUD_RESOLVED stays committed. The profile ban may already be active even
      // when the Auth sync fails, so the required follow-up is made explicit.
      return {
        ok: false,
        error: 'persistence-error',
        message: `Objective fraud was resolved, but the permanent ban needs follow-up: ${ban.message}`,
      };
    }

    await createNotification({
      userId: outcome.victimId,
      type: 'TRADE',
      title: 'Fraud confirmed — you are being compensated',
      body:
        "NoDitto support confirmed objective fraud. The other trader's collateral is being " +
        'paid to you after a 7-day safety hold, and your own trade collateral has been released.',
      link: `/trades/${tradeId}`,
    });
    await createNotification({
      userId: resolution.offendingTraderId,
      type: 'TRADE',
      title: 'Fraud confirmed — your account is permanently suspended',
      body: 'NoDitto support confirmed objective fraud on your trade. Your trade collateral has been captured.',
      link: `/trades/${tradeId}`,
    });
  } else if (outcome.kind === 'UNFOUNDED' || outcome.kind === 'CONDITION') {
    const body =
      outcome.kind === 'UNFOUNDED'
        ? 'NoDitto support reviewed the dispute and found no problem with the trade. Your trade collateral has been released.'
        : 'NoDitto support reviewed the condition dispute and decided compensation. Any amount owed is paid after a 7-day safety hold, and the rest of the trade collateral has been released.';
    for (const userId of [initiatorId, counterpartId]) {
      await createNotification({ userId, type: 'TRADE', title: 'Dispute resolved', body, link: `/trades/${tradeId}` });
    }
  }
  // NO_EXCHANGE notifies both traders inside the coordinator.

  if (resolution.feeRefundFailed) {
    // Already logged as `trade.fee_refund`; retried by the fee drain.
    console.warn(`[admin] trade ${tradeId}: fee refund on NO_EXCHANGE failed`);
  }

  return {
    ok: true,
    data: {
      id: tradeId,
      state: trade.state,
      outcome: resolution.outcome,
      manualReconciliation: resolution.manualReconciliation,
    },
  };
});

/**
 * Narrow the custody backstop on a disputed trade to ONE trader, staff-gated.
 *
 * By default the backstop takes every live hold on a DISPUTED trade into custody at
 * its own margin, whoever filed. Narrowing it to the accused is a staff decision only:
 * if a member's claim chose whose collateral survives, a fraudster could file first
 * against the victim and let their own hold lapse. `accusedId: null` restores 'ALL'.
 */
export const setDisputeCustodyScope = withActionLog('admin.setDisputeCustodyScope', async function setDisputeCustodyScope(
  tradeId: string,
  accusedId: string | null,
): Promise<AdminActionResult<{ id: string; scope: 'ALL' | 'ACCUSED_ONLY' }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const admin = createAdminClient();
  const { data: trade, error: readError } = await admin
    .from('trades')
    .select('id, state, initiator_id, counterpart_id')
    .eq('id', tradeId)
    .maybeSingle();
  if (readError) return { ok: false, error: 'persistence-error', message: readError.message };
  if (!trade) return { ok: false, error: 'not-found' };

  if (trade.state !== 'DISPUTED') {
    return { ok: false, error: 'persistence-error', message: 'INVALID_OUTCOME: only a disputed trade has a safeguard scope.' };
  }
  if (accusedId !== null && accusedId !== trade.initiator_id && accusedId !== trade.counterpart_id) {
    return { ok: false, error: 'persistence-error', message: 'INVALID_OUTCOME: that member is not a party to this trade.' };
  }

  const scope = accusedId === null ? 'ALL' : 'ACCUSED_ONLY';
  const { error } = await admin
    .from('trades')
    .update({ custody_scope: scope, custody_accused_id: accusedId })
    .eq('id', tradeId)
    .eq('state', 'DISPUTED');
  if (error) return { ok: false, error: 'persistence-error', message: error.message };

  revalidatePath(`/admin/arbitration/TRADE/${tradeId}`);
  return { ok: true, data: { id: tradeId, scope } };
});

/**
 * The reconciliation verdict for ONE region, as the console renders it: the pure
 * position plus the currency it is denominated in and, when the balance could not be
 * read, why.
 *
 * Per region because each region is a separate Stripe platform account with its own
 * balance. Summing them would be the same mistake `getPlatformBalance` already
 * refuses to make across currencies — a total that looks reassuring and means
 * nothing.
 */
export type CustodyReport = CustodyPosition & {
  /** ISO 3166-1 alpha-2 of the platform account this position belongs to. */
  region: string;
  currency: string;
  unreadableReason: string | null;
};

/**
 * The region whose Stripe platform account holds a contract's money.
 *
 * Resolved from the contract's frozen `currency` rather than from the seller's
 * current profile region, because the currency is what the money actually is and it
 * cannot drift: a seller whose region were later corrected would otherwise have
 * their in-flight contracts pointed at a platform account that never held the funds.
 *
 * Falls back to the default region when the row or the currency cannot be mapped;
 * the provider then refuses anything genuinely mismatched rather than paying the
 * wrong account.
 */
async function regionForCashSale(cashSaleId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from('cash_sales')
    .select('currency')
    .eq('id', cashSaleId)
    .maybeSingle();

  const currency = (data?.currency as string | null)?.toLowerCase() ?? null;
  if (!currency) return DEFAULT_CONFIG_REGION;

  for (const code of operationalRegions()) {
    if (regionCurrency(code) === currency) return code;
  }
  return DEFAULT_CONFIG_REGION;
}

// The classification and the derived list live in domain/payouts/custodyReconciliation.ts,
// where the meaning of "held" is defined. A 'use server' module may only export async
// functions, so a Record declared here would be unreachable from a test - and this is
// exactly the kind of list that needs one.

/**
 * Reconcile what the platform owes members against what the provider says it holds.
 *
 * THE ONE CHECK THAT IS NOT CIRCULAR. Every other money figure on this console is
 * derived from `cash_sales` — a statement about our own belief. This is the only one
 * that asks the provider, and it is therefore the only one that can detect a chargeback,
 * a provider fee, or an automatic payout quietly draining the balance members' funds sit
 * in. None of those write a row.
 *
 * Deliberately admin-gated rather than staff-gated: this is the platform's own solvency,
 * not a member's contract, and it is not information an arbitrator needs to decide a
 * case.
 */
const TERMINAL_TRADE_STATES = new Set(['COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED']);

/**
 * Read every captured hold in one currency as custody inputs (design §1.8).
 *
 * A hold captured by the custody backstop or a resolution (`custody_captured_at` set)
 * is drawn down by its SETTLED `collateral_disbursements` rows, platform-retained ones
 * included. A LEGACY partial capture from the pre-fix condition path moved its money
 * outside that table: its paid return share counts as disbursed, and its platform half
 * becomes the platform's own once the trade is terminal. Counted naively, every closed
 * legacy case would show its whole $20 as held forever.
 *
 * Not exported: a `'use server'` module may only export async Server Actions.
 */
async function loadCapturedCollateral(
  admin: ReturnType<typeof createAdminClient>,
  currency: string,
): Promise<{ ok: true; inputs: HeldCollateralInput[] } | { ok: false; message: string }> {
  const { data: holds, error } = await admin
    .from('pre_auth_holds')
    .select('hold_ref, trade_id, captured_cents, custody_captured_at')
    .gt('captured_cents', 0);
  if (error) return { ok: false, message: error.message };
  const rows = ((holds ?? []) as Array<{
    hold_ref: string | null;
    trade_id: string;
    captured_cents: number;
    custody_captured_at: string | null;
  }>).filter((row) => row.hold_ref);
  if (rows.length === 0) return { ok: true, inputs: [] };

  const tradeIds = [...new Set(rows.map((row) => row.trade_id))];
  const [{ data: trades, error: tradeError }, { data: disbursed, error: disbursedError }] = await Promise.all([
    admin
      .from('trades')
      .select('id, state, currency, friction_tax_platform_cents, friction_tax_return_cents, friction_tax_return_paid_at')
      .in('id', tradeIds),
    admin
      .from('collateral_disbursements')
      .select('hold_ref, amount_minor, status')
      .in('trade_id', tradeIds)
      .eq('status', 'SETTLED'),
  ]);
  if (tradeError) return { ok: false, message: tradeError.message };
  if (disbursedError) return { ok: false, message: disbursedError.message };

  const tradeOf = new Map(
    ((trades ?? []) as Array<{
      id: string;
      state: string;
      currency: string | null;
      friction_tax_platform_cents: number | null;
      friction_tax_return_cents: number | null;
      friction_tax_return_paid_at: string | null;
    }>).map((trade) => [trade.id, trade]),
  );
  const settledByHold = new Map<string, number>();
  for (const row of (disbursed ?? []) as Array<{ hold_ref: string; amount_minor: number }>) {
    settledByHold.set(row.hold_ref, (settledByHold.get(row.hold_ref) ?? 0) + Number(row.amount_minor ?? 0));
  }

  const inputs: HeldCollateralInput[] = [];
  for (const row of rows) {
    const trade = tradeOf.get(row.trade_id);
    // Scoped to this region's balance, like the sales above.
    if (!trade || String(trade.currency ?? 'aud').toLowerCase() !== currency) continue;
    const settled = settledByHold.get(row.hold_ref as string) ?? 0;
    const legacy = !row.custody_captured_at;
    const legacyReturnPaid =
      legacy && trade.friction_tax_return_paid_at ? Number(trade.friction_tax_return_cents ?? 0) : 0;
    inputs.push({
      holdRef: row.hold_ref as string,
      capturedCents: Number(row.captured_cents ?? 0),
      settledDisbursedCents: settled + legacyReturnPaid,
      resolved: TERMINAL_TRADE_STATES.has(trade.state),
      platformRetainedCents: legacy ? Number(trade.friction_tax_platform_cents ?? 0) : 0,
    });
  }
  return { ok: true, inputs };
}

export const getCustodyPosition = withActionLog('admin.getCustodyPosition', async function getCustodyPosition(
  region?: string | null,
): Promise<AdminActionResult<CustodyReport>> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const code =
    normalizeRegionCode(region) ??
    [...operationalRegions()][0] ??
    DEFAULT_CONFIG_REGION;
  const currency = regionCurrency(code) ?? 'aud';

  const admin = createAdminClient();

  const [{ data: rows, error }, balance] = await Promise.all([
    admin
      .from('cash_sales')
      .select('id, status, amount_cents, refund_cents, refund_status, seller_payout_status')
      .in('status', [...COLLECTED_SALE_STATUSES])
      // Scoped to this region's contracts, because they are the only ones whose money
      // is in this platform account's balance. Comparing all regions' obligations
      // against one region's balance would invent a shortfall the size of every other
      // region.
      .eq('currency', currency),
    getPaymentService(code).getPlatformBalance(),
  ]);

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  const sales: HeldSaleInput[] = (rows ?? []).map((row) => {
    const refundSettled = row.refund_status === 'SETTLED';
    const settledRefundCents = refundSettled ? Number(row.refund_cents ?? 0) : 0;
    // Nothing further is held once the Seller has been released, or once a refund has
    // returned the whole collected amount. Anything else — including a FAILED release —
    // is still the platform's to hold and therefore still owed.
    const fullyDisbursed =
      row.seller_payout_status === 'SETTLED' ||
      (row.status === 'REFUNDED' && refundSettled);

    return {
      id: row.id as string,
      collectedCents: Number(row.amount_cents ?? 0),
      settledRefundCents,
      fullyDisbursed,
    };
  });

  // Captured trade collateral (design §1.8, ESC-01). Uncaptured authorisations are
  // still excluded: only `captured_cents > 0` rows are money in this balance.
  const collateral = await loadCapturedCollateral(admin, currency);
  if (!collateral.ok) {
    return { ok: false, error: 'persistence-error', message: collateral.message };
  }

  // ESC-05/06: trade cash legs the platform collected and has not yet paid out. A
  // leg counts from COLLECTED until RELEASED or REFUNDED; a pending release or refund
  // is still held.
  const { data: legs, error: legError } = await admin
    .from('trade_cash_settlements')
    .select('trade_id, amount_minor, status')
    .eq('currency', currency)
    .in('status', ['COLLECTED', 'RELEASE_PENDING', 'REFUND_PENDING', 'RELEASED', 'REFUNDED']);
  if (legError) {
    return { ok: false, error: 'persistence-error', message: legError.message };
  }
  const tradeCash: HeldTradeCashInput[] = (legs ?? []).map((row) => ({
    tradeId: row.trade_id as string,
    collectedCents: Number(row.amount_minor ?? 0),
    settledOutCents:
      row.status === 'RELEASED' || row.status === 'REFUNDED' ? Number(row.amount_minor ?? 0) : 0,
  }));

  const position = reconcileCustody({
    sales,
    collateral: collateral.inputs,
    tradeCash,
    balance: {
      availableCents: balance.availableCents,
      pendingCents: balance.pendingCents,
      readable: balance.status === 'READ',
    },
  });

  return {
    ok: true,
    data: {
      ...position,
      region: code,
      currency: balance.currency,
      unreadableReason: balance.status === 'READ' ? null : (balance.reason ?? null),
    },
  };
});

/**
 * Run one pass of the owed-release queue (Req 4.3), admin-gated.
 *
 * The same work the scheduled job does, exposed so an operator can drain the
 * queue on demand rather than waiting for the next hour.
 */
export const drainCashSalePayouts = withActionLog('admin.drainCashSalePayouts', async function drainCashSalePayouts(): Promise<
  AdminActionResult<{ considered: number; settled: number; stillOwed: number }>
> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // Run ONCE PER REGION (0068). The drain releases funds to sellers, and each region's
  // funds sit in that region's own Stripe platform account — one pass on one account
  // could only pay the sellers in its own region and would fail on the rest as
  // cross-region transfers. Totals are summed because the figures are counts of
  // contracts, not money; nothing here adds amounts across currencies.
  const totals = { considered: 0, settled: 0, stillOwed: 0 };
  for (const region of operationalRegions()) {
    const orchestrator = createDefaultCashSaleOrchestrator({
      payments: getPaymentService(region),
      // Scoped so this pass only attempts the contracts whose money is in the account
      // it is holding. Without it every region's pass would try every contract.
      payoutRegionCurrency: regionCurrency(region) ?? undefined,
    });
    const result = await orchestrator.processDuePayouts();
    totals.considered += result.considered;
    totals.settled += result.settled;
    totals.stillOwed += result.stillOwed;
  }

  revalidatePath('/admin');
  return { ok: true, data: totals };
});
