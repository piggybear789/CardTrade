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
import { revalidatePath, updateTag } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { getVerifiedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { REFERENCES_CACHE_TAG } from '@/lib/references/cacheTag';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { REFERENCE_PROOF_BUCKET } from '@/lib/storage/referenceImagesShared';
import { isClaimPlatform, normalizeClaimHandle } from '@/domain/references/reference';
import { removeAvatarObject } from '@/lib/storage/profileImages';
import { enforceProfileFraudBan, permanentlyBanConfirmedFraudOffender } from '@/lib/auth/fraudBan';
import { clusterStrengthForReport } from '@/lib/risk/scamClusters';
import { removeScamEvidence } from '@/lib/storage/scamReportEvidence';
import { SCAM_REPORT_LIMITS, canFraudBan, type ScamMatchStrength } from '@/domain/risk/scamReports';
import { requireStaff } from '@/lib/staffGate';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import type { CashSaleDisputeOutcome, TrackingFlagDecision } from '@/domain/orchestrator/cashSaleOrchestrator';
import { CASH_SALE_INSPECTION_DAYS } from '@/domain/fulfilment/inspection';
import { createLoggedDisputeOrchestrator } from '@/lib/trades/disputeOrchestrator';
import type { TradeDisputeOutcome } from '@/domain/orchestrator/disputeResolution';
import { regionForProfile, regionForTrade } from '@/lib/regionBinding';
import { applyIdentityDecision } from '@/lib/identity/applyIdentityDecision';
import { payeePairHash, splitFullName } from '@/domain/identity/payeeNameMatch';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import {
  COLLECTED_SALE_STATUSES,
  reconcileCustody,
  type CustodyPosition,
  type HeldSaleInput,
  type HeldCollateralInput,
  type HeldTradeCashInput,
} from '@/domain/payouts/custodyReconciliation';
import { getPaymentService, operationalPlatforms } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { normalizeRegionCode, platformRegion, regionCurrency } from '@/domain/region';
import { regionForCashSale as regionForCashSaleBinding } from '@/lib/regionBinding';
import type { Enums } from '@/lib/supabase/database.types';
import { createNotification } from '@/lib/notifications/createNotification';
import {
  caseParticipants,
  cashSaleValueMinor,
  gateResolution,
  reopenProposal,
  staffIds,
  tradeValueMinor,
} from '@/lib/arbitration/approvals';
import {
  canApprove,
  isRecused,
  otherApproversFor,
  type ResolutionAction,
} from '@/domain/arbitration/approvalPolicy';
import {
  asTrustedSellerDecision,
  TRUSTED_SELLER_NOTES_MAX_LENGTH,
  trustedSellerApprovalBlocker,
  trustedSellerDecisionOutcome,
  type TrustedSellerDecision,
  type TrustedSellerReviewStatus,
} from '@/domain/trustedSellers/trustedSellerReview';

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
  | 'duplicate-banned'
  /** ESC-23: the decision was saved as a proposal for a second staff member. */
  | 'approval-required'
  /** ESC-23: the approval id is not an APPROVED proposal for this decision. */
  | 'approval-invalid'
  /** ESC-23: approval refusals from `canApprove`. */
  | 'SAME_STAFFER'
  | 'COOLING_OFF'
  | 'RECUSED'
  /** Trusted Seller (0152): approval needs the member's identity verified first. */
  | 'identity-unverified';

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
  // Confirmed with the auth server: a staff account signed out everywhere stops at once.
  const user = await getVerifiedAuthUser();

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
  /** ESC-23: set only by `approveStaffResolution`. */
  approvalId?: string,
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const approval = await gateResolution({
    action: 'RESOLVE_CASH_SALE_RETURN',
    caseRef: cashSaleId,
    valueMinor: () => cashSaleValueMinor(cashSaleId),
    payload: { outcome },
    staffId: gate.ctx.userId,
    approvalId,
  });
  if (!approval.proceed) return { ok: false, error: approval.error, message: approval.message };

  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.resolveReturnCase({
    cashSaleId,
    actorId: gate.ctx.userId,
    outcome,
  });
  await approval.settle(result.ok);

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
  /** ESC-23: set only by `approveStaffResolution`. */
  approvalId?: string,
): Promise<AdminActionResult<{ id: string; status: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  // Only a refund moves money; starting the clock does not.
  const approval = await gateResolution({
    action: 'RESOLVE_TRACKING_FLAG',
    caseRef: cashSaleId,
    valueMinor: decision === 'REFUND_BUYER' ? () => cashSaleValueMinor(cashSaleId) : 0,
    payload: { decision },
    staffId: gate.ctx.userId,
    approvalId,
  });
  if (!approval.proceed) return { ok: false, error: approval.error, message: approval.message };
  const orchestrator = createDefaultCashSaleOrchestrator({
    payments: getPaymentService(await regionForCashSale(cashSaleId)),
  });
  const result = await orchestrator.resolveTrackingFlag({
    cashSaleId,
    staffId: gate.ctx.userId,
    decision,
    inspectionDays: CASH_SALE_INSPECTION_DAYS,
  });
  await approval.settle(result.ok);
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

/** What the member is told about each Trusted Seller decision. Never the reason. */
const TRUSTED_SELLER_NOTIFICATION: Record<TrustedSellerDecision, { title: string; body: string }> = {
  APPROVE: {
    title: "You're a Trusted Seller",
    body: 'Our team reviewed your application. Your Trusted Seller badge now shows on your profile and listings.',
  },
  DECLINE: {
    title: 'Trusted Seller application',
    body: "We couldn't approve your Trusted Seller application this time. You can keep selling as normal.",
  },
  REVOKE: {
    title: 'Trusted Seller badge removed',
    body: 'Your Trusted Seller badge has been removed. You can keep selling as normal.',
  },
};

/**
 * Decide a Trusted Seller review (0152). Admin-only.
 *
 * Writes the review row and nothing else: `profiles.trusted_seller_at` follows from it
 * by trigger, so the badge cannot disagree with the decision. Approval refuses a member
 * who is not identity-verified, is suspended or has closed their account, and the
 * database refuses the same three again.
 *
 * The status update is conditional on the status it was read at, so two admins
 * deciding the same row at once cannot both win.
 */
export const decideTrustedSeller = withActionLog('admin.decideTrustedSeller', async function decideTrustedSeller(
  reviewId: string,
  decisionInput: TrustedSellerDecision,
): Promise<AdminActionResult<{ id: string; status: TrustedSellerReviewStatus }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const decision = asTrustedSellerDecision(decisionInput);
  if (!decision) {
    return { ok: false, error: 'invalid-input', field: 'decision', message: 'Unknown decision.' };
  }

  const admin = createAdminClient();
  const { data: review, error: readError } = await admin
    .from('trusted_seller_reviews')
    .select('id, profile_id, status')
    .eq('id', reviewId)
    .maybeSingle();
  if (readError) return { ok: false, error: 'persistence-error', message: readError.message };
  if (!review) return { ok: false, error: 'not-found' };

  const next = trustedSellerDecisionOutcome(review.status, decision);
  if (!next) {
    return {
      ok: false,
      error: 'invalid-input',
      message: `This application is already ${review.status.toLowerCase()}. Reload to see the latest.`,
    };
  }

  if (next === 'APPROVED') {
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('identity_check_status, fraud_banned_at, closed_at')
      .eq('id', review.profile_id)
      .maybeSingle();
    if (profileError) return { ok: false, error: 'persistence-error', message: profileError.message };
    if (!profile) return { ok: false, error: 'not-found' };
    const blocker = trustedSellerApprovalBlocker({
      identityVerified: profile.identity_check_status === 'VERIFIED',
      fraudBanned: Boolean(profile.fraud_banned_at),
      closed: Boolean(profile.closed_at),
    });
    if (blocker === 'identity-unverified') {
      return {
        ok: false,
        error: 'identity-unverified',
        message: "They haven't passed the ID check yet. Approve once they have.",
      };
    }
    if (blocker) {
      return {
        ok: false,
        error: 'invalid-input',
        message:
          blocker === 'account-suspended'
            ? 'This account is suspended and cannot be approved.'
            : 'This account is closed and cannot be approved.',
      };
    }
  }

  const { data: updated, error: writeError } = await admin
    .from('trusted_seller_reviews')
    .update({
      status: next,
      decided_at: new Date().toISOString(),
      decided_by: gate.adminId,
      decision_reason: null,
    })
    .eq('id', review.id)
    .eq('status', review.status)
    .select('id')
    .maybeSingle();
  if (writeError) return { ok: false, error: 'persistence-error', message: writeError.message };
  if (!updated) {
    return {
      ok: false,
      error: 'invalid-input',
      message: 'Someone else changed this application. Reload to see the latest.',
    };
  }

  const notice = TRUSTED_SELLER_NOTIFICATION[decision];
  await createNotification({
    userId: review.profile_id,
    type: 'SYSTEM',
    title: notice.title,
    body: notice.body,
    link: '/trusted-sellers/apply',
  });

  revalidatePath('/admin');
  revalidatePath(`/sellers/${review.profile_id}`);
  return { ok: true, data: { id: review.id, status: next } };
});

/**
 * Save the staff working notes on a Trusted Seller review (0152). Admin-only.
 *
 * Notes never reach the member: the column has no member grant. Blank clears them.
 */
export const saveTrustedSellerNotes = withActionLog('admin.saveTrustedSellerNotes', async function saveTrustedSellerNotes(
  reviewId: string,
  notes: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const trimmed = typeof notes === 'string' ? notes.trim() : '';
  if (trimmed.length > TRUSTED_SELLER_NOTES_MAX_LENGTH) {
    return {
      ok: false,
      error: 'invalid-input',
      field: 'notes',
      message: `Keep notes under ${TRUSTED_SELLER_NOTES_MAX_LENGTH.toLocaleString('en-AU')} characters.`,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trusted_seller_reviews')
    .update({ staff_notes: trimmed || null })
    .eq('id', reviewId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };

  revalidatePath('/admin');
  return { ok: true, data: { id: data.id } };
});

/**
 * Clear a payout-name mismatch staff have checked (ESC-25), e.g. "Bob" on the bank
 * account for a "Robert" on the ID. Records an HMAC of the (identity, payee) name
 * pair, never the names, so the clearance holds while the pair is unchanged and a
 * DIFFERENT payee name is checked again.
 */
export const clearPayeeMismatch = withActionLog('admin.clearPayeeMismatch', async function clearPayeeMismatch(
  profileId: string,
): Promise<AdminActionResult<{ id: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, identity_check_name, merchant_ref')
    .eq('id', profileId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!profile?.merchant_ref) return { ok: false, error: 'not-found' };

  const payments = getPaymentService(await regionForProfile(profileId));
  const merchant = payments.getManagedMerchant
    ? await payments.getManagedMerchant(profile.merchant_ref as string)
    : null;
  const identity = splitFullName(profile.identity_check_name as string | null);
  const secret = process.env.IDENTITY_FINGERPRINT_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '';
  const pair =
    identity && merchant?.individualName ? payeePairHash(identity, merchant.individualName, secret) : null;
  if (!pair) {
    return { ok: false, error: 'invalid-input', message: 'The two names could not be read, so there is nothing to clear.' };
  }
  const { error: writeError } = await admin
    .from('profiles')
    .update({
      payee_identity_mismatch_at: null,
      payee_mismatch_cleared_by: gate.ctx.userId,
      payee_mismatch_cleared_at: new Date().toISOString(),
      payee_mismatch_cleared_pair: pair,
    })
    .eq('id', profileId);
  if (writeError) return { ok: false, error: 'persistence-error', message: writeError.message };
  revalidatePath('/admin');
  return { ok: true, data: { id: profileId } };
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
  /** ESC-23: set only by `approveStaffResolution`. */
  approvalId?: string,
): Promise<AdminActionResult<{ id: string; reversalRef: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
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
  // ESC-23: a second staff member confirms before a clawback above the threshold.
  const approval = await gateResolution({
    action: 'REVERSE_CASH_SALE_PAYOUT',
    caseRef: cashSaleId,
    valueMinor: amountMinor,
    payload: { amountMinor },
    staffId: gate.ctx.userId,
    approvalId,
  });
  if (!approval.proceed) return { ok: false, error: approval.error, message: approval.message };
  const reversal = await payments.reversePayout({
    transferId: data.seller_payout_ref as string,
    amount: amountMinor,
    nonce: `cash-sale:${cashSaleId}`,
  });
  await approval.settle(reversal.status === 'SETTLED');
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
  /** ESC-23: set only by `approveStaffResolution`. */
  approvalId?: string,
): Promise<AdminActionResult<{ id: string; status: string; refundCents: number }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const approval = await gateResolution({
    action: 'RESOLVE_CASH_SALE_DISPUTE',
    caseRef: cashSaleId,
    valueMinor: () => cashSaleValueMinor(cashSaleId),
    payload: { outcome, refundCents: refundCents ?? null, requireReturn: requireReturn ?? null },
    staffId: gate.ctx.userId,
    approvalId,
  });
  if (!approval.proceed) return { ok: false, error: approval.error, message: approval.message };

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
  await approval.settle(result.ok);

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
  /** ESC-23: set only by `approveStaffResolution`. */
  approvalId?: string,
): Promise<AdminActionResult<ResolveTradeDisputeActionData>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  // A fraud finding always needs a second approver: it also bans a member for good.
  const approval = await gateResolution({
    action: 'RESOLVE_TRADE_DISPUTE',
    caseRef: tradeId,
    // Valued by the money the outcome can move (collateral, collected cash, fees), not
    // by its label: an UNFOUNDED or NO_EXCHANGE unwind can move a large cash leg.
    valueMinor: () => tradeValueMinor(tradeId),
    payload: { outcome },
    staffId: gate.ctx.userId,
    approvalId,
    fraud: outcome.kind === 'FRAUD',
  });
  if (!approval.proceed) return { ok: false, error: approval.error, message: approval.message };

  const result = await (await buildAdminDisputeOrchestrator(tradeId)).resolveTradeDispute({
    tradeId,
    actorId: gate.ctx.userId,
    outcome,
  });
  await approval.settle(result.ok);

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
    // The ban removed the offender from every reference graph (0155 trigger).
    updateTag(REFERENCES_CACHE_TAG);
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
  /**
   * Foreign-currency sales still held whose converted amount is not on file, so they
   * are missing from the owed figure. Non-zero means the position is incomplete.
   */
  unconvertedSales: number;
  /**
   * Other currencies this platform holds member money in, each reconciled by its own
   * position (`getCustodyPosition(region, currency)`). Sales charged on behalf of a
   * cross-border seller settle in the seller's currency, not the platform's.
   */
  otherCurrencies: string[];
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
  // The shared binding, not a second copy of it: this used to re-derive the
  // currency-to-region loop locally, which would have resolved a EUR sale to "DE"
  // rather than to the US platform that actually holds the money.
  return regionForCashSaleBinding(cashSaleId);
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
  /** Every currency this platform holds money for; others belong to another balance. */
  platformCurrencies: readonly string[] = [currency],
): Promise<
  { ok: true; inputs: HeldCollateralInput[]; unconverted: number } | { ok: false; message: string }
> {
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
  if (rows.length === 0) return { ok: true, inputs: [], unconverted: 0 };

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
  const platform = new Set(platformCurrencies.map((code) => code.toLowerCase()));
  let unconverted = 0;
  for (const row of rows) {
    const trade = tradeOf.get(row.trade_id);
    if (!trade) continue;
    const tradeCurrency = String(trade.currency ?? 'aud').toLowerCase();
    if (tradeCurrency !== currency) {
      // Another currency on THIS platform's balance: counted as unconverted while the
      // case is open, never silently dropped. Other platforms' rows are not ours.
      if (platform.has(tradeCurrency) && !TERMINAL_TRADE_STATES.has(trade.state)) unconverted += 1;
      continue;
    }
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
  return { ok: true, inputs, unconverted };
}

export const getCustodyPosition = withActionLog('admin.getCustodyPosition', async function getCustodyPosition(
  region?: string | null,
  /**
   * The balance currency to reconcile; defaults to the platform's settlement currency.
   * Another currency covers only the sales charged on behalf of sellers that settled
   * in it: collateral and trade cash are plain platform charges, converted on arrival.
   */
  balanceCurrency?: string | null,
): Promise<AdminActionResult<CustodyReport>> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // A PLATFORM, not a member's country: the US platform's balance holds the money for
  // every region it serves, so custody is reconciled once per platform account.
  const platforms = operationalPlatforms();
  const requested = normalizeRegionCode(region);
  const code =
    (requested ? platformRegion(requested) : null) ??
    [...platforms.keys()][0] ??
    DEFAULT_CONFIG_REGION;
  const settles = regionCurrency(code) ?? 'aud';
  const currencies = platforms.get(code) ?? [settles];
  const view = balanceCurrency?.trim().toLowerCase() || settles;
  const isSettlementView = view === settles;

  const admin = createAdminClient();

  const [{ data: rows, error }, balance] = await Promise.all([
    admin
      .from('cash_sales')
      .select(
        'id, status, currency, amount_cents, refund_cents, refund_status, seller_payout_status, fx_fee_cents, settlement_amount_cents, settlement_currency',
      )
      .in('status', [...COLLECTED_SALE_STATUSES])
      // Scoped to this PLATFORM's contracts, in every currency it holds money for,
      // because they are the only ones whose money is in this account's balance.
      .in('currency', isSettlementView ? [...currencies] : [view]),
    getPaymentService(code).getPlatformBalance(view),
  ]);

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  const sales: HeldSaleInput[] = [];
  let unconverted = 0;
  const otherCurrencies = new Set<string>();
  for (const row of rows ?? []) {
    const refundSettled = row.refund_status === 'SETTLED';
    const refundCents = refundSettled ? Number(row.refund_cents ?? 0) : 0;
    const contractCents = Number(row.amount_cents ?? 0);
    // Nothing further is held once the Seller has been released, or once a refund has
    // returned the whole collected amount. Anything else — including a FAILED release —
    // is still the platform's to hold and therefore still owed.
    const fullyDisbursed =
      row.seller_payout_status === 'SETTLED' ||
      (row.status === 'REFUNDED' && refundSettled);
    const rowCurrency = (row.currency as string).toLowerCase();
    // Charged on behalf of a cross-border seller: it settled in its own currency, so it
    // sits in that currency's balance and is reconciled against it, at face value.
    const settledInOwnCurrency =
      rowCurrency !== settles && String(row.settlement_currency ?? '').toLowerCase() === rowCurrency;

    if (!isSettlementView) {
      if (settledInOwnCurrency) {
        sales.push({
          id: row.id as string,
          collectedCents: contractCents,
          settledRefundCents: refundCents,
          fullyDisbursed,
        });
      }
      // A sale in this currency that was CONVERTED (collected before on-behalf-of
      // charging) is in the settlement currency's balance and counted there.
      continue;
    }

    if (settledInOwnCurrency) {
      if (!fullyDisbursed) otherCurrencies.add(rowCurrency);
      continue;
    }

    if (rowCurrency === settles) {
      sales.push({
        id: row.id as string,
        collectedCents: contractCents,
        settledRefundCents: refundCents,
        fullyDisbursed,
      });
      continue;
    }

    // A FOREIGN-CURRENCY contract (0136). Its obligation is in, say, EUR while the
    // balance is USD, and adding the two would be meaningless. The balance received
    // `settlement_amount_cents` for the buyer's whole charge (contract + conversion
    // fee), so the contract's share of it is what the platform holds for this sale.
    const settled = Number(row.settlement_amount_cents ?? 0);
    if (!settled || row.settlement_currency !== settles) {
      // Recorded before 0136 or the balance transaction lagged. Left out of the sum
      // and COUNTED, so the panel says how much it could not convert rather than
      // reporting a healthy position it never checked.
      if (!fullyDisbursed) unconverted += 1;
      continue;
    }
    const charged = contractCents + Number(row.fx_fee_cents ?? 0);
    const toSettlement = (cents: number) => (charged > 0 ? Math.round((cents * settled) / charged) : 0);
    sales.push({
      id: row.id as string,
      collectedCents: toSettlement(contractCents),
      settledRefundCents: toSettlement(refundCents),
      fullyDisbursed,
    });
  }

  // Captured trade collateral (design §1.8, ESC-01). Uncaptured authorisations are
  // still excluded: only `captured_cents > 0` rows are money in this balance. Both it
  // and trade cash are plain platform charges, converted into the settlement currency,
  // so another currency's view has neither.
  const noCollateral: { ok: true; inputs: HeldCollateralInput[]; unconverted: number } = {
    ok: true,
    inputs: [],
    unconverted: 0,
  };
  const collateral = isSettlementView
    ? await loadCapturedCollateral(admin, settles, currencies)
    : noCollateral;
  if (!collateral.ok) {
    return { ok: false, error: 'persistence-error', message: collateral.message };
  }
  // Foreign-currency captured collateral has no recorded settlement amount yet, so it
  // cannot be added to a balance in another currency. It is COUNTED, never dropped.
  unconverted += collateral.unconverted;

  // ESC-05/06: trade cash legs the platform collected and has not yet paid out. A
  // leg counts from COLLECTED until RELEASED or REFUNDED; a pending release or refund
  // is still held.
  const { data: legs, error: legError } = isSettlementView
    ? await admin
        .from('trade_cash_settlements')
        .select('trade_id, amount_minor, status, currency')
        .in('currency', [...currencies])
        .in('status', ['COLLECTED', 'RELEASE_PENDING', 'REFUND_PENDING', 'RELEASED', 'REFUNDED'])
    : { data: [], error: null };
  if (legError) {
    return { ok: false, error: 'persistence-error', message: legError.message };
  }
  const tradeCash: HeldTradeCashInput[] = [];
  for (const row of legs ?? []) {
    const stillHeld = row.status !== 'RELEASED' && row.status !== 'REFUNDED';
    if (String(row.currency).toLowerCase() !== settles) {
      if (stillHeld) unconverted += 1;
      continue;
    }
    tradeCash.push({
      tradeId: row.trade_id as string,
      collectedCents: Number(row.amount_minor ?? 0),
      settledOutCents: stillHeld ? 0 : Number(row.amount_minor ?? 0),
    });
  }

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
      unconvertedSales: unconverted,
      otherCurrencies: [...otherCurrencies].sort(),
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
  // Once per PLATFORM and currency: the US platform holds USD, EUR, GBP, ... contracts,
  // and looping over regions instead would drain it once per EEA country.
  const totals = { considered: 0, settled: 0, stillOwed: 0 };
  for (const [platform, currencies] of operationalPlatforms()) {
    for (const currency of currencies) {
      const orchestrator = createDefaultCashSaleOrchestrator({
        payments: getPaymentService(platform),
        // Scoped so this pass only attempts the contracts whose money is in the
        // account it is holding.
        payoutRegionCurrency: currency,
      });
      const result = await orchestrator.processDuePayouts();
      totals.considered += result.considered;
      totals.settled += result.settled;
      totals.stillOwed += result.stillOwed;
    }
  }

  revalidatePath('/admin');
  return { ok: true, data: totals };
});

/**
 * Approve a pending staff decision and run it (ESC-23).
 *
 * The approver must be a different staff member, not a party to the case. On a
 * one-person team the proposer may approve after `SOLO_COOLING_OFF_HOURS`. The
 * decision then runs through the same action that proposed it, with the proposal id,
 * so every guard in that action applies again.
 */
export const approveStaffResolution = withActionLog('admin.approveStaffResolution', async function approveStaffResolution(
  proposalId: string,
): Promise<AdminActionResult<{ id: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) return { ok: false, error: gate.error };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = () => (admin as any).from('staff_resolution_proposals');
  const { data: proposal, error } = await table()
    .select('id, action, case_ref, payload, status, proposed_by, proposed_at')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!proposal) return { ok: false, error: 'not-found' };

  const action = proposal.action as ResolutionAction;
  // Authorization facts fail CLOSED: a read error refuses rather than reading as
  // "no participants" or "nobody else can approve".
  let participantIds: string[];
  let staff: string[];
  try {
    [participantIds, staff] = await Promise.all([caseParticipants(action, proposal.case_ref), staffIds()]);
  } catch {
    return { ok: false, error: 'persistence-error', message: 'Could not check this approval. Try again.' };
  }
  const refusal = canApprove({
    status: proposal.status,
    proposedBy: proposal.proposed_by,
    proposedAt: proposal.proposed_at,
    approverId: gate.ctx.userId,
    participantIds,
    otherApprovers: otherApproversFor(staff, proposal.proposed_by, participantIds),
    now: new Date(),
  });
  if (refusal === 'NOT_PENDING') {
    return { ok: false, error: 'approval-invalid', message: 'That proposal is no longer waiting for approval.' };
  }
  if (refusal) {
    const messages: Record<typeof refusal, string> = {
      SAME_STAFFER: 'A different staff member has to approve this.',
      COOLING_OFF: 'Nobody else can approve this, so you can approve it yourself 24 hours after proposing it.',
      RECUSED: 'You are a party to this case, so you cannot approve it.',
    };
    return { ok: false, error: refusal, message: messages[refusal] };
  }

  const { data: claimed, error: claimError } = await table()
    .update({ status: 'APPROVED', decided_by: gate.ctx.userId, decided_at: new Date().toISOString() })
    .eq('id', proposalId)
    .eq('status', 'PENDING')
    .select('id');
  if (claimError) return { ok: false, error: 'persistence-error', message: claimError.message };
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: 'approval-invalid', message: 'Someone else decided this proposal first.' };
  }

  const payload = (proposal.payload ?? {}) as Record<string, unknown>;
  const ref = proposal.case_ref as string;
  let result: AdminActionResult<unknown>;
  try {
    result = await executeApprovedProposal(action, ref, payload, proposalId);
  } catch (error) {
    // A throw must not leave the row EXECUTED with nothing moved, or APPROVED forever.
    await reopenProposal(proposalId);
    throw error;
  }
  // The queue and every case page, which list pending proposals.
  revalidatePath('/admin/arbitration', 'layout');
  if (!result.ok) {
    // Back to PENDING so a fresh approval can be given (0145 allows one open row).
    await reopenProposal(proposalId);
    return { ok: false, error: result.error, message: result.message };
  }
  return { ok: true, data: { id: proposalId } };
});

/** Run an approved proposal through the action that proposed it, with its stored payload. */
async function executeApprovedProposal(
  action: ResolutionAction,
  ref: string,
  payload: Record<string, unknown>,
  proposalId: string,
): Promise<AdminActionResult<unknown>> {
  let result: AdminActionResult<unknown>;
  switch (action) {
    case 'RESOLVE_CASH_SALE_DISPUTE':
      result = await resolveCashSaleDispute(
        ref,
        payload.outcome as CashSaleDisputeOutcome,
        (payload.refundCents as number | null) ?? undefined,
        (payload.requireReturn as boolean | null) ?? undefined,
        proposalId,
      );
      break;
    case 'RESOLVE_CASH_SALE_RETURN':
      result = await resolveCashSaleReturnCase(ref, payload.outcome as 'REFUND_BUYER' | 'RELEASE_SELLER', proposalId);
      break;
    case 'RESOLVE_TRACKING_FLAG':
      result = await resolveTrackingFlag(ref, payload.decision as TrackingFlagDecision, proposalId);
      break;
    case 'REVERSE_CASH_SALE_PAYOUT':
      result = await reverseCashSalePayout(ref, Number(payload.amountMinor), proposalId);
      break;
    case 'RESOLVE_TRADE_DISPUTE':
      result = await resolveTradeDispute(ref, payload.outcome as TradeDisputeOutcome, proposalId);
      break;
    default:
      return { ok: false, error: 'invalid-input', message: 'Unknown proposal action.' };
  }
  return result;
}

/**
 * Reject a pending staff decision (ESC-23), or withdraw your own. Nothing moves.
 *
 * A party to the case may not reject either: a staff member who could turn away every
 * decision made against them would hold their own case open forever.
 */
export const rejectStaffResolution = withActionLog('admin.rejectStaffResolution', async function rejectStaffResolution(
  proposalId: string,
  note?: string,
): Promise<AdminActionResult<{ id: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) return { ok: false, error: gate.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = () => (createAdminClient() as any).from('staff_resolution_proposals');
  const { data: proposal, error: readError } = await table()
    .select('action, case_ref')
    .eq('id', proposalId)
    .maybeSingle();
  if (readError) return { ok: false, error: 'persistence-error', message: readError.message };
  if (!proposal) return { ok: false, error: 'not-found' };
  let participantIds: string[];
  try {
    participantIds = await caseParticipants(proposal.action as ResolutionAction, proposal.case_ref as string);
  } catch {
    return { ok: false, error: 'persistence-error', message: 'Could not check this proposal. Try again.' };
  }
  if (isRecused(gate.ctx.userId, participantIds)) {
    return { ok: false, error: 'RECUSED', message: 'You are a party to this case, so you cannot decide it.' };
  }

  const { data, error } = await table()
    .update({
      status: 'REJECTED',
      decided_by: gate.ctx.userId,
      decided_at: new Date().toISOString(),
      note: note?.trim().slice(0, 2000) || null,
    })
    .eq('id', proposalId)
    .eq('status', 'PENDING')
    .select('id');
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'approval-invalid', message: 'That proposal is no longer waiting for approval.' };
  }
  revalidatePath('/admin/arbitration', 'layout');
  return { ok: true, data: { id: proposalId } };
});

// ---------------------------------------------------------------------------
// Off-platform scam reports (scam-reports spec). Admin-only, like the rest of the
// console. Nothing here runs on its own: every action is a staff decision, and a
// staff member who is the reporter or the matched member is refused (recusal).
// ---------------------------------------------------------------------------

/** The reporter and the matched member of one report, for recusal. */
async function scamReportParties(reportId: string): Promise<{ reporterId: string | null } | null> {
  const { data, error } = await createAdminClient()
    .from('scam_reports')
    .select('reporter_id')
    .eq('id', reportId)
    .maybeSingle();
  if (error || !data) return null;
  return { reporterId: data.reporter_id };
}

function recusedFromScamReport(staffId: string, parties: { reporterId: string | null }, profileId?: string): boolean {
  return staffId === parties.reporterId || (profileId !== undefined && staffId === profileId);
}

/** Mark a report reviewed or corroborated. */
export const reviewScamReport = withActionLog('admin.reviewScamReport', async function reviewScamReport(
  reportId: string,
  status: 'REVIEWED' | 'CORROBORATED',
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (status !== 'REVIEWED' && status !== 'CORROBORATED') {
    return { ok: false, error: 'invalid-input', message: 'Unknown status.' };
  }
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties)) {
    return { ok: false, error: 'RECUSED', message: 'You filed this report, so you cannot review it.' };
  }

  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from('scam_reports')
    .update({ status, reviewed_by: gate.adminId, reviewed_at: now, updated_at: now })
    .eq('id', reportId)
    .not('status', 'in', '(DISMISSED,WITHDRAWN)')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'invalid-input', message: 'This report was dismissed or withdrawn.' };
  revalidatePath('/admin');
  return { ok: true, data: { id: data.id } };
});

/** Private staff notes on a report. Blank clears them. */
export const saveScamReportNotes = withActionLog('admin.saveScamReportNotes', async function saveScamReportNotes(
  reportId: string,
  notes: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const trimmed = typeof notes === 'string' ? notes.trim() : '';
  if (trimmed.length > SCAM_REPORT_LIMITS.narrativeMax) {
    return { ok: false, error: 'invalid-input', field: 'notes', message: 'Keep notes under 4,000 characters.' };
  }
  const { data, error } = await createAdminClient()
    .from('scam_reports')
    .update({ staff_notes: trimmed || null, updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  revalidatePath('/admin');
  return { ok: true, data: { id: data.id } };
});

/**
 * Dismiss a report as wrong, unsupported or malicious. Its matches are deleted at once
 * and the report itself is deleted by the `:17` job 90 days later. Members it matched
 * who had been notified are told it was cleared.
 */
export const dismissScamReport = withActionLog('admin.dismissScamReport', async function dismissScamReport(
  reportId: string,
  reason: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why || why.length > 500) {
    return { ok: false, error: 'invalid-input', field: 'reason', message: 'Give a short reason (up to 500 characters).' };
  }
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties)) {
    return { ok: false, error: 'RECUSED', message: 'You filed this report, so you cannot decide it.' };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('scam_reports')
    .update({
      status: 'DISMISSED',
      dismiss_reason: why,
      dismissed_at: now,
      reviewed_by: gate.adminId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', reportId)
    .not('status', 'in', '(DISMISSED,WITHDRAWN)')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'invalid-input', message: 'This report was already dismissed or withdrawn.' };

  const { data: matches, error: matchReadError } = await admin
    .from('scam_report_matches')
    .delete()
    .eq('report_id', reportId)
    .select('profile_id, notified_at');
  if (matchReadError) return { ok: false, error: 'persistence-error', message: matchReadError.message };
  for (const match of matches ?? []) {
    if (!match.notified_at) continue;
    await createNotification({
      userId: match.profile_id,
      type: 'SYSTEM',
      title: 'Report cleared',
      body: 'We looked into the report we told you about and closed it. There’s nothing more you need to do.',
      link: null,
    });
  }

  revalidatePath('/admin');
  return { ok: true, data: { id: data.id } };
});

/**
 * Dismiss one match: the wrong person, or someone being impersonated. The match is
 * deleted, never kept, and the member is told if they had been notified.
 */
export const dismissScamReportMatch = withActionLog('admin.dismissScamReportMatch', async function dismissScamReportMatch(
  reportId: string,
  profileId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties, profileId)) {
    return { ok: false, error: 'RECUSED', message: 'You are a party to this report, so you cannot decide it.' };
  }

  const { data, error } = await createAdminClient()
    .from('scam_report_matches')
    .delete()
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .select('notified_at')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  if (data.notified_at) {
    await createNotification({
      userId: profileId,
      type: 'SYSTEM',
      title: 'Report cleared',
      body: 'We looked into the report we told you about and found it wasn’t about you. There’s nothing more you need to do.',
      link: null,
    });
  }
  revalidatePath('/admin');
  return { ok: true, data: { id: reportId } };
});

/**
 * Tell a matched member there is a report and give them 14 days to respond. The notice
 * names no reporter, identifier or story (Req 8.1).
 */
export const notifyScamReportMatch = withActionLog('admin.notifyScamReportMatch', async function notifyScamReportMatch(
  reportId: string,
  profileId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties, profileId)) {
    return { ok: false, error: 'RECUSED', message: 'You are a party to this report, so you cannot decide it.' };
  }

  const now = new Date();
  const due = new Date(now.getTime() + SCAM_REPORT_LIMITS.responseDays * 86_400_000);
  const { data, error } = await createAdminClient()
    .from('scam_report_matches')
    .update({ notified_at: now.toISOString(), response_due_at: due.toISOString() })
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .is('notified_at', null)
    .select('report_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'invalid-input', message: 'They have already been told.' };

  await createNotification({
    userId: profileId,
    type: 'SYSTEM',
    title: 'We need to check something with you',
    body: `We've received a report involving details linked to your account. Tell us your side by ${due.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}.`,
    link: `/report-scam/response/${reportId}`,
  });
  revalidatePath('/admin');
  return { ok: true, data: { id: reportId } };
});

/** Record that staff believe the match is the right person. Acts on nothing by itself. */
export const confirmScamReportMatch = withActionLog('admin.confirmScamReportMatch', async function confirmScamReportMatch(
  reportId: string,
  profileId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties, profileId)) {
    return { ok: false, error: 'RECUSED', message: 'You are a party to this report, so you cannot decide it.' };
  }
  const { data, error } = await createAdminClient()
    .from('scam_report_matches')
    .update({ status: 'CONFIRMED', decided_by: gate.adminId, decided_at: new Date().toISOString() })
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .select('report_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  revalidatePath('/admin');
  return { ok: true, data: { id: reportId } };
});

/**
 * Put a staff hold on (or lift it from) a member's unreleased cash-sale payouts. The
 * release policy already honours `seller_payout_hold_reason = 'STAFF'`. Lifting only
 * clears a STAFF hold, never a chargeback or fraud-warning hold.
 */
export const setMemberPayoutHold = withActionLog('admin.setMemberPayoutHold', async function setMemberPayoutHold(
  profileId: string,
  hold: boolean,
): Promise<AdminActionResult<{ id: string; affected: number }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.adminId === profileId) {
    return { ok: false, error: 'RECUSED', message: 'You cannot hold your own payouts.' };
  }
  const admin = createAdminClient();
  const query = admin
    .from('cash_sales')
    .update({ seller_payout_hold_reason: hold ? 'STAFF' : null })
    .eq('seller_id', profileId)
    .neq('seller_payout_status', 'SETTLED');
  const { data, error } = await (hold
    ? query.is('seller_payout_hold_reason', null)
    : query.eq('seller_payout_hold_reason', 'STAFF')
  ).select('id');
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  revalidatePath('/admin');
  return { ok: true, data: { id: profileId, affected: (data ?? []).length } };
});

/**
 * Propose a fraud ban on off-platform reports (Req 7.3). Refused unless the cluster is
 * corroborated, the match is not handle-only, and the member has had their say. It is
 * a PROPOSAL: a second admin approves it with {@link approveScamFraudBan}.
 */
export const proposeScamFraudBan = withActionLog('admin.proposeScamFraudBan', async function proposeScamFraudBan(
  reportId: string,
  profileId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };
  if (recusedFromScamReport(gate.adminId, parties, profileId)) {
    return { ok: false, error: 'RECUSED', message: 'You are a party to this report, so you cannot decide it.' };
  }

  const admin = createAdminClient();
  const { data: match, error: matchError } = await admin
    .from('scam_report_matches')
    .select('strength, notified_at, responded_at, response_due_at, ban_proposed_at')
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (matchError) return { ok: false, error: 'persistence-error', message: matchError.message };
  if (!match) return { ok: false, error: 'not-found' };
  if (match.ban_proposed_at) {
    return { ok: false, error: 'approval-required', message: 'A ban is already proposed and waiting for a second admin.' };
  }

  let strength: number;
  try {
    strength = await clusterStrengthForReport(reportId, admin);
  } catch {
    return { ok: false, error: 'persistence-error', message: 'Could not check how many reports back this up. Try again.' };
  }
  const allowed = canFraudBan({
    clusterStrength: strength,
    matchStrength: match.strength as ScamMatchStrength,
    notifiedAt: match.notified_at,
    respondedAt: match.responded_at,
    responseDueAt: match.response_due_at,
    now: new Date(),
  });
  if (!allowed.ok) return { ok: false, error: 'invalid-input', message: allowed.reason };

  const { error } = await admin
    .from('scam_report_matches')
    .update({ ban_proposed_by: gate.adminId, ban_proposed_at: new Date().toISOString() })
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .is('ban_proposed_at', null);
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  revalidatePath('/admin');
  return { ok: false, error: 'approval-required', message: 'Ban proposed. A second admin needs to approve it.' };
});

/**
 * Approve a proposed scam-report fraud ban and carry it out. The approver must be a
 * different admin, or the same one after the solo cooling-off period when they are
 * the only staff account (`canApprove`). The guard is re-checked at approval.
 */
export const approveScamFraudBan = withActionLog('admin.approveScamFraudBan', async function approveScamFraudBan(
  reportId: string,
  profileId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parties = await scamReportParties(reportId);
  if (!parties) return { ok: false, error: 'not-found' };

  const admin = createAdminClient();
  const { data: match, error: matchError } = await admin
    .from('scam_report_matches')
    .select('strength, notified_at, responded_at, response_due_at, ban_proposed_by, ban_proposed_at')
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (matchError) return { ok: false, error: 'persistence-error', message: matchError.message };
  if (!match?.ban_proposed_by || !match.ban_proposed_at) {
    return { ok: false, error: 'invalid-input', message: 'No ban has been proposed.' };
  }

  let staff: string[];
  let strength: number;
  try {
    [staff, strength] = await Promise.all([staffIds(), clusterStrengthForReport(reportId, admin)]);
  } catch {
    return { ok: false, error: 'persistence-error', message: 'Could not check the approval. Try again.' };
  }
  const banParties = [parties.reporterId, profileId];
  const refusal = canApprove({
    status: 'PENDING',
    proposedBy: match.ban_proposed_by,
    proposedAt: match.ban_proposed_at,
    approverId: gate.adminId,
    participantIds: banParties,
    otherApprovers: otherApproversFor(staff, match.ban_proposed_by, banParties),
    now: new Date(),
  });
  if (refusal === 'SAME_STAFFER') return { ok: false, error: 'SAME_STAFFER', message: 'A different admin needs to approve this.' };
  if (refusal === 'COOLING_OFF') return { ok: false, error: 'COOLING_OFF', message: 'Nobody else can approve this, so you can approve it yourself 24 hours after proposing it.' };
  if (refusal === 'RECUSED') return { ok: false, error: 'RECUSED', message: 'You are a party to this report, so you cannot decide it.' };
  if (refusal) return { ok: false, error: 'approval-invalid', message: 'This proposal can’t be approved.' };

  const allowed = canFraudBan({
    clusterStrength: strength,
    matchStrength: match.strength as ScamMatchStrength,
    notifiedAt: match.notified_at,
    respondedAt: match.responded_at,
    responseDueAt: match.response_due_at,
    now: new Date(),
  });
  if (!allowed.ok) return { ok: false, error: 'invalid-input', message: allowed.reason };

  const banned = await enforceProfileFraudBan({ profileId, staffId: gate.adminId });
  // The ban removed them from every reference graph (0155 trigger), even if a later
  // step of it failed.
  updateTag(REFERENCES_CACHE_TAG);
  if (!banned.ok) return { ok: false, error: 'persistence-error', message: banned.message };

  const { error } = await admin
    .from('scam_report_matches')
    .update({ status: 'CONFIRMED', decided_by: gate.adminId, decided_at: new Date().toISOString() })
    .eq('report_id', reportId)
    .eq('profile_id', profileId);
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  revalidatePath('/admin');
  return { ok: true, data: { id: reportId } };
});

/**
 * Delete a report outright, with its fingerprints, matches and evidence: for a
 * successful correction request from the person it concerns (Req 9.6).
 */
export const deleteScamReport = withActionLog('admin.deleteScamReport', async function deleteScamReport(
  reportId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from('scam_reports')
    .select('id, evidence_paths')
    .eq('id', reportId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!report) return { ok: false, error: 'not-found' };

  const { data: matches } = await admin
    .from('scam_report_matches')
    .select('member_response_paths')
    .eq('report_id', reportId);
  const paths = [
    ...(report.evidence_paths ?? []),
    ...(matches ?? []).flatMap((match) => match.member_response_paths ?? []),
  ];
  const storageError = await removeScamEvidence(admin, paths);
  if (storageError) return { ok: false, error: 'persistence-error', message: storageError };

  // Identifiers and matches go with it (`on delete cascade`).
  const { error: deleteError } = await admin.from('scam_reports').delete().eq('id', reportId);
  if (deleteError) return { ok: false, error: 'persistence-error', message: deleteError.message };
  revalidatePath('/admin');
  return { ok: true, data: { id: reportId } };
});

// ---------------------------------------------------------------------------
// References (0155): handle claims, proof checks, disputed references.
// The queues are staff work, so they live here behind requireAdmin. Deciding
// a claim writes the claim itself; the DB trigger then moves the handle's
// references onto the claimant's profile.
// ---------------------------------------------------------------------------

/** Approve or decline a bio-code handle claim. Approval claims the handle. */
export const decideHandleClaim = withActionLog('admin.decideHandleClaim', async function decideHandleClaim(
  requestId: string,
  decision: 'APPROVE' | 'DECLINE',
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from('handle_claim_requests')
    .select('id, claim_id, claimant_id, status')
    .eq('id', requestId)
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!request) return { ok: false, error: 'not-found' };
  if (request.status !== 'PENDING') {
    return { ok: false, error: 'invalid-input', message: 'This claim was already decided.' };
  }

  const { data: claim, error: claimLookupError } = await admin
    .from('social_claims')
    .select('platform, handle, claimed_profile_id')
    .eq('id', request.claim_id)
    .maybeSingle();
  if (claimLookupError) return { ok: false, error: 'persistence-error', message: claimLookupError.message };
  if (!claim) return { ok: false, error: 'not-found' };

  if (decision === 'APPROVE') {
    if (claim.claimed_profile_id && claim.claimed_profile_id !== request.claimant_id) {
      return { ok: false, error: 'invalid-input', message: 'This handle was claimed by someone else.' };
    }
    // Staff approve on a screenshot, so the claimant must be ID-verified, the same rule
    // `submitManualHandleClaim` applies at submission. Checked again here for a request
    // filed before that rule, or a claimant who is no longer verified.
    const { data: claimant, error: claimantError } = await admin
      .from('profiles')
      .select('identity_check_status, fraud_banned_at, closed_at')
      .eq('id', request.claimant_id)
      .maybeSingle();
    if (claimantError) return { ok: false, error: 'persistence-error', message: claimantError.message };
    if (!claimant || claimant.fraud_banned_at || claimant.closed_at) {
      return { ok: false, error: 'invalid-input', message: "This member's account can't claim handles. Decline the claim." };
    }
    if (
      !satisfiesIdentityGate({
        identityCheckStatus: (claimant.identity_check_status ?? 'NONE') as IdentityCheckStatus,
      })
    ) {
      return {
        ok: false,
        error: 'invalid-input',
        message: "The claimant hasn't verified their ID, so this claim can't be approved yet. Leave it pending or decline it.",
      };
    }
    if (!claim.claimed_profile_id) {
      const { data: claimed, error: claimError } = await admin
        .from('social_claims')
        .update({
          claimed_profile_id: request.claimant_id,
          claim_method: 'BIO_CODE',
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.claim_id)
        .is('claimed_profile_id', null)
        .select('id')
        .maybeSingle();
      if (claimError) return { ok: false, error: 'persistence-error', message: claimError.message };
      if (!claimed) {
        return { ok: false, error: 'invalid-input', message: 'This handle was claimed by someone else. Decline the claim.' };
      }
    }
  }

  const { error: decideError } = await admin
    .from('handle_claim_requests')
    .update({
      status: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED',
      decided_by: gate.adminId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'PENDING');
  if (decideError) return { ok: false, error: 'persistence-error', message: decideError.message };

  await createNotification({
    userId: request.claimant_id,
    type: 'SYSTEM',
    title: decision === 'APPROVE' ? 'Your handle is claimed' : 'Your handle claim wasn\u2019t approved',
    body:
      decision === 'APPROVE'
        ? `@${claim.handle} on ${claim.platform} is now linked to your verified profile, with its references.`
        : `We couldn't confirm @${claim.handle} on ${claim.platform} is yours. You can try again with a clearer screenshot.`,
    link: decision === 'APPROVE' ? `/sellers/${request.claimant_id}` : '/references',
  });
  if (decision === 'APPROVE') updateTag(REFERENCES_CACHE_TAG);
  revalidatePath('/admin');
  return { ok: true, data: { id: requestId } };
});

/** Mark a reference's attached proof as checked (earns the receipt-checked display). */
export const setReferenceProofChecked = withActionLog('admin.setReferenceProofChecked', async function setReferenceProofChecked(
  referenceId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('member_references')
    .update({ proof_status: 'CHECKED', updated_at: new Date().toISOString() })
    .eq('id', referenceId)
    .eq('proof_status', 'PENDING')
    .select('target_profile_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  updateTag(REFERENCES_CACHE_TAG);
  if (data.target_profile_id) revalidatePath(`/sellers/${data.target_profile_id}`);
  revalidatePath('/admin');
  return { ok: true, data: { id: referenceId } };
});

/**
 * Take a reference down (0164/0165): it leaves every page at once, and the record keeps
 * who removed it and why. The staff remedy for an experience that breaks the rules
 * (abuse, someone else's personal details, a deal that never happened). Members are
 * never told by whom; the author sees it gone from their own list.
 */
export const removeReference = withActionLog('admin.removeReference', async function removeReference(
  referenceId: string,
  reason: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    return { ok: false, error: 'invalid-input', message: 'Say why, in 3 to 500 characters.', field: 'reason' };
  }

  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from('member_references')
    .update({
      status: 'REMOVED',
      removed_by: gate.adminId,
      removed_at: now,
      removed_reason: trimmed,
      updated_at: now,
    })
    .eq('id', referenceId)
    .eq('status', 'LIVE')
    .select('target_profile_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'persistence-error', message: error.message };
  if (!data) return { ok: false, error: 'not-found' };
  updateTag(REFERENCES_CACHE_TAG);
  revalidatePath('/references', 'layout');
  if (data.target_profile_id) revalidatePath(`/sellers/${data.target_profile_id}`);
  revalidatePath('/admin');
  return { ok: true, data: { id: referenceId } };
});

/**
 * Refuse a reference's proof: the screenshots don't show the deal. The reference stays
 * live as a plain vouch, and its screenshots are deleted, so a refused receipt (often a
 * screenshot of someone's chat) is not kept.
 */
export const rejectReferenceProof = withActionLog('admin.rejectReferenceProof', async function rejectReferenceProof(
  referenceId: string,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const admin = createAdminClient();
  const { data: reference, error: loadError } = await admin
    .from('member_references')
    .select('proof_paths, target_profile_id')
    .eq('id', referenceId)
    .eq('proof_status', 'PENDING')
    .maybeSingle();
  if (loadError) return { ok: false, error: 'persistence-error', message: loadError.message };
  if (!reference) return { ok: false, error: 'not-found' };

  const { error } = await admin
    .from('member_references')
    .update({ proof_status: 'NONE', proof_paths: [], updated_at: new Date().toISOString() })
    .eq('id', referenceId)
    .eq('proof_status', 'PENDING');
  if (error) return { ok: false, error: 'persistence-error', message: error.message };

  if (reference.proof_paths.length > 0) {
    const { error: storageError } = await admin.storage
      .from(REFERENCE_PROOF_BUCKET)
      .remove(reference.proof_paths);
    if (storageError) {
      await logBackgroundFailure({
        name: 'references.proof.delete',
        errorCode: 'STORAGE_REMOVE_FAILED',
        message: storageError.message,
        context: { referenceId },
      });
    }
  }
  revalidatePath('/admin');
  return { ok: true, data: { id: referenceId } };
});

/**
 * Release a handle claimed by the wrong member (0165 `release_social_claim`): the
 * references left FOR the handle go back to it, the claim is cleared, and its real owner
 * can claim it. References left for the member directly stay with the member.
 */
export const releaseHandleClaim = withActionLog('admin.releaseHandleClaim', async function releaseHandleClaim(
  platform: string,
  rawHandle: string,
): Promise<AdminActionResult<{ id: string; moved: number }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isClaimPlatform(platform)) {
    return { ok: false, error: 'invalid-input', message: 'Choose the platform.', field: 'platform' };
  }
  const handle = normalizeClaimHandle(platform, rawHandle);
  if (!handle) return { ok: false, error: 'invalid-input', message: 'Enter a valid handle.', field: 'handle' };

  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin
    .from('social_claims')
    .select('id, claimed_profile_id')
    .eq('platform', platform)
    .eq('handle_norm', handle.toLowerCase())
    .maybeSingle();
  if (claimError) return { ok: false, error: 'persistence-error', message: claimError.message };
  if (!claim) return { ok: false, error: 'not-found', message: 'Nobody has that handle on that platform.' };
  if (!claim.claimed_profile_id) {
    return { ok: false, error: 'invalid-input', message: 'That handle is not claimed.' };
  }

  const { data: moved, error } = await admin.rpc('release_social_claim', { p_claim_id: claim.id });
  if (error) return { ok: false, error: 'persistence-error', message: error.message };

  await createNotification({
    userId: claim.claimed_profile_id,
    type: 'SYSTEM',
    title: 'A handle was unlinked from your profile',
    body: `@${handle} on ${platform} is no longer linked to your profile. If it is yours, claim it again from its references page.`,
    link: '/references',
  });
  updateTag(REFERENCES_CACHE_TAG);
  revalidatePath('/references', 'layout');
  revalidatePath(`/sellers/${claim.claimed_profile_id}`);
  revalidatePath('/admin');
  return { ok: true, data: { id: claim.id, moved: moved ?? 0 } };
});
