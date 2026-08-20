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
// ONE DELIBERATE EXCEPTION. The three dispute-resolution actions
// (`resolveCashSaleDispute`, `resolveTradeConditionDispute`, `resolveTradeFraud`) gate
// on `requireStaff` rather than `requireAdmin`, because arbitration is the support
// worker's job and does not need the power to hide listings or drain payout queues.
// They still never trust the client, and an admin passes that gate too. Everything
// else in this module is admin-only.
//
// Every export is an async Server Action; shared shapes are `export type` only.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeAvatarObject } from '@/lib/storage/profileImages';
import { permanentlyBanConfirmedFraudOffender } from '@/lib/auth/fraudBan';
import { requireStaff } from '@/lib/staffGate';
import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import type { CashSaleDisputeOutcome } from '@/domain/orchestrator/cashSaleOrchestrator';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { createDefaultDisputeResolutionOrchestrator } from '@/domain/orchestrator/supabaseDisputeResolutionRepository';
import {
  COLLECTED_SALE_STATUSES,
  reconcileCustody,
  type CustodyPosition,
  type HeldSaleInput,
} from '@/domain/payouts/custodyReconciliation';
import { getPaymentService, operationalRegions } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { normalizeRegionCode, regionCurrency } from '@/domain/region';
import type { Enums } from '@/lib/supabase/database.types';
import { createNotification } from '@/lib/notifications/createNotification';
import { emailNotify } from '@/lib/email';

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
  | 'persistence-error';

/** Discriminated result returned by every admin action. */
export type AdminActionResult<T = { id: string }> =
  | { ok: true; data: T }
  | { ok: false; error: AdminActionError; message?: string };

/**
 * Build the dispute/fraud resolution orchestrator with the default bindings.
 *
 * Mirrors `buildDisputeOrchestrator` in `lib/actions/trades.ts`. Duplicated rather
 * than shared because a `'use server'` module may only export async functions, so
 * the helper cannot be exported from there.
 */
function buildAdminDisputeOrchestrator() {
  const service = getPaymentService();
  const orchestrator = createDefaultTradeOrchestrator({ payments: service });
  return createDefaultDisputeResolutionOrchestrator({
    orchestrator,
    payments: service,
  });
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'not-authenticated' };
  }

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
export async function hideItem(itemId: string): Promise<AdminActionResult> {
  return setItemHidden(itemId, true);
}

/** Un-hide a listing (restores it to the public catalog). Admin-only. */
export async function unhideItem(itemId: string): Promise<AdminActionResult> {
  return setItemHidden(itemId, false);
}

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
export async function clearMemberAvatar(profileId: string): Promise<AdminActionResult> {
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
}

/**
 * Set a report's status. `ACTIONED` also stamps `reviewed_by`/`reviewed_at`;
 * `DISMISSED` records the reviewer as well so triage is auditable. Admin-only.
 */
export async function setReportStatus(
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
}

/**
 * Clear a trade's manual-reconciliation flag once an admin has reviewed the
 * flagged trade. Admin-only.
 */
export async function clearTradeReconciliationFlag(
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
}

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
export async function retryCashSalePayout(
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
}

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
export async function resolveCashSaleReturnCase(
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
}

export async function resolveCashSaleDispute(
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
}

/**
 * Resolve a disputed Trade as a Condition_Dispute (Req 7.2-7.5), staff-gated.
 *
 * Captures the fixed $20 Friction_Tax from the disputed-against trader and voids the
 * remaining collateral, completing the Trade.
 *
 * Staff-gated because it used to be participant-gated: `resolveDispute` in
 * `lib/actions/trades.ts` let either party trigger a capture against the other. The
 * point of moving it was that a party must not decide their own case — not that only
 * an administrator may decide it.
 */
export async function resolveTradeConditionDispute(
  tradeId: string,
): Promise<AdminActionResult<{ id: string; state: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const result = await buildAdminDisputeOrchestrator().resolveConditionDispute({
    tradeId,
    actorId: gate.ctx.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'TRADE_NOT_FOUND' ? 'not-found' : 'persistence-error',
      message: result.detail ?? 'The dispute could not be resolved.',
    };
  }

  revalidatePath('/admin');
  revalidatePath('/admin/arbitration');
  revalidatePath(`/admin/arbitration/TRADE/${tradeId}`);
  revalidatePath(`/trades/${tradeId}`);

  // Notify both traders of the resolution.
  const trade = result.trade;
  await createNotification({
    userId: trade.initiator_id as string,
    type: 'TRADE',
    title: 'Dispute resolved',
    body: 'NoDitto support reviewed the condition dispute and resolved it. Your trade collateral has been settled.',
    link: `/trades/${tradeId}`,
  });
  await createNotification({
    userId: trade.counterpart_id as string,
    type: 'TRADE',
    title: 'Dispute resolved',
    body: 'NoDitto support reviewed the condition dispute and resolved it. Your trade collateral has been settled.',
    link: `/trades/${tradeId}`,
  });
  void emailNotify.disputeRaised({ userId: trade.initiator_id as string, contractType: 'trade', contractId: tradeId });
  void emailNotify.disputeRaised({ userId: trade.counterpart_id as string, contractType: 'trade', contractId: tradeId });

  return { ok: true, data: { id: tradeId, state: result.trade.state } };
}

/**
 * Resolve a disputed Trade as Objective_Fraud (Req 8.1-8.6), staff-gated.
 *
 * Full-captures the offending trader's collateral, pays it to the operator-determined
 * victim, and voids the victim's own hold.
 *
 * THE VICTIM IS AN ARGUMENT, and that is the entire point of this function existing.
 * `reportObjectiveFraud` previously inferred the victim from its caller, and its
 * caller was any participant — so a trader could name themselves the victim and take
 * the counterparty's 100%-of-FMV collateral with no review, no evidence, and no
 * chance for the accused to answer. A participant can now only CLAIM fraud
 * (`reportFraud`), which freezes the trade; an operator decides who was defrauded.
 *
 * The victim is validated against the trade's participants downstream, so naming an
 * unrelated account fails rather than paying a stranger.
 */
export async function resolveTradeFraud(
  tradeId: string,
  victimId: string,
): Promise<AdminActionResult<{ id: string; state: string }>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (!victimId) {
    return {
      ok: false,
      error: 'persistence-error',
      message: 'Name the trader who was defrauded before resolving.',
    };
  }

  const result = await buildAdminDisputeOrchestrator().reportObjectiveFraud({
    tradeId,
    actorId: gate.ctx.userId,
    victimId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === 'TRADE_NOT_FOUND'
          ? 'not-found'
          : 'persistence-error',
      message:
        result.error === 'NOT_PARTICIPANT'
          ? 'That member is not a party to this trade.'
          : (result.detail ?? 'The fraud resolution could not be completed.'),
    };
  }

  const ban = await permanentlyBanConfirmedFraudOffender({
    offenderId: result.outcome.offendingTraderId,
    staffId: gate.ctx.userId,
    tradeId,
  });

  if (!ban.ok) {
    // FRAUD_RESOLVED remains committed. The profile ban may already be active even
    // when the Auth sync fails, so make the required staff follow-up explicit.
    revalidatePath('/admin');
    revalidatePath('/admin/arbitration');
    revalidatePath(`/admin/arbitration/TRADE/${tradeId}`);
    revalidatePath(`/trades/${tradeId}`);
    return {
      ok: false,
      error: 'persistence-error',
      message: `Objective fraud was resolved, but the permanent ban needs follow-up: ${ban.message}`,
    };
  }

  revalidatePath('/admin');
  revalidatePath('/admin/arbitration');
  revalidatePath(`/admin/arbitration/TRADE/${tradeId}`);
  revalidatePath(`/trades/${tradeId}`);

  // Notify both traders of the fraud resolution.
  const outcome = result.outcome;
  const victimUserId = victimId;
  const offenderId = outcome.offendingTraderId as string;

  await createNotification({
    userId: victimUserId,
    type: 'TRADE',
    title: 'Fraud confirmed — you are being compensated',
    body: 'NoDitto support confirmed objective fraud. The offender\'s collateral is being released to you.',
    link: `/trades/${tradeId}`,
  });
  await createNotification({
    userId: offenderId,
    type: 'TRADE',
    title: 'Fraud confirmed — your account is permanently suspended',
    body: 'NoDitto support confirmed objective fraud on your trade. Your collateral has been captured.',
    link: `/trades/${tradeId}`,
  });

  return { ok: true, data: { id: tradeId, state: result.outcome.trade.state } };
}

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
export async function getCustodyPosition(
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

  const position = reconcileCustody({
    sales,
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
}

/**
 * Run one pass of the owed-release queue (Req 4.3), admin-gated.
 *
 * The same work the scheduled job does, exposed so an operator can drain the
 * queue on demand rather than waiting for the next hour.
 */
export async function drainCashSalePayouts(): Promise<
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
}
