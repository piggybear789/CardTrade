'use server';

// lib/actions/reviews.ts
//
// Server Actions for post-transaction REAL REVIEWS (Phase 5). A review can only
// be left by a party to a COMPLETED transaction about the counterparty:
//   - cash_sale: the buyer reviews the seller (or vice versa) once the sale is
//     COMPLETED.
//   - trade:     either participant reviews the other once the trade is
//     COMPLETED.
//
// Reviews are inserted via the cookie-bound client so RLS enforces
// `reviewer_id = auth.uid()` on insert; the DB unique(reviewer_id, source_type,
// source_id) constraint prevents duplicate reviews for the same transaction (we
// map that to a typed `already-reviewed` error). A DB trigger owns
// `profiles.rating` / `rating_count`, so we NEVER write those columns here —
// we only insert the review row.
//
// Ratings are integers 1..5; comments are optional and capped at 1000 chars.
// Every export is an async Server Action; shared shapes are `export type` only.

import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/notifications/createNotification';
import type { Tables } from '@/lib/supabase/database.types';

/** A persisted review row. */
export type ReviewRow = Tables<'reviews'>;

/** The transaction kinds a review can be attached to. */
export type ReviewSourceType = 'cash_sale' | 'trade';

/** Max length of the optional free-text comment. */
const COMMENT_MAX = 1000;

// ---------------------------------------------------------------------------
// leaveReview
// ---------------------------------------------------------------------------

/** Arguments for {@link leaveReview}. */
export interface LeaveReviewInput {
  /** The counterparty being reviewed. */
  revieweeId: string;
  /** Integer rating 1..5. */
  rating: number;
  /** Optional free-text comment (<= 1000 chars). */
  comment?: string | null;
  /** Which transaction the review is about. */
  sourceType: ReviewSourceType;
  /** The transaction id (cash_sales.id or trades.id). */
  sourceId: string;
}

/**
 * Error codes surfaced by {@link leaveReview}.
 * - `not-authenticated` — no signed-in user.
 * - `validation-error`  — rating out of 1..5 or comment too long.
 * - `not-a-participant` — the caller was not a party to the transaction.
 * - `not-completed`     — the transaction is not COMPLETED yet.
 * - `invalid-reviewee`  — `revieweeId` is not the counterparty.
 * - `already-reviewed`  — the caller already reviewed this transaction.
 * - `persistence-error` — the insert failed.
 */
export type LeaveReviewError =
  | 'not-authenticated'
  | 'validation-error'
  | 'not-a-participant'
  | 'not-completed'
  | 'invalid-reviewee'
  | 'already-reviewed'
  | 'persistence-error';

/** Discriminated result returned by {@link leaveReview}. */
export type LeaveReviewResult =
  | { ok: true; data: ReviewRow }
  | { ok: false; error: LeaveReviewError; message?: string };

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/**
 * Resolve the eligibility of `callerId` to review `revieweeId` for the given
 * transaction: the caller must have been a party, the transaction must be
 * COMPLETED, and `revieweeId` must be the OTHER party. Returns a typed error on
 * failure, or `{ ok: true }` when the caller may proceed to insert.
 */
async function checkEligibility(
  client: Awaited<ReturnType<typeof createClient>>,
  callerId: string,
  revieweeId: string,
  sourceType: ReviewSourceType,
  sourceId: string,
): Promise<{ ok: true } | { ok: false; error: LeaveReviewError }> {
  if (sourceType === 'cash_sale') {
    const { data: sale } = await client
      .from('cash_sales')
      .select('id, buyer_id, seller_id, status')
      .eq('id', sourceId)
      .maybeSingle();

    if (!sale) return { ok: false, error: 'not-a-participant' };

    const isParticipant =
      sale.buyer_id === callerId || sale.seller_id === callerId;
    if (!isParticipant) return { ok: false, error: 'not-a-participant' };

    if (sale.status !== 'COMPLETED') return { ok: false, error: 'not-completed' };

    const counterparty =
      sale.buyer_id === callerId ? sale.seller_id : sale.buyer_id;
    if (counterparty !== revieweeId) {
      return { ok: false, error: 'invalid-reviewee' };
    }
    return { ok: true };
  }

  // trade
  const { data: trade } = await client
    .from('trades')
    .select('id, initiator_id, counterpart_id, state')
    .eq('id', sourceId)
    .maybeSingle();

  if (!trade) return { ok: false, error: 'not-a-participant' };

  const isParticipant =
    trade.initiator_id === callerId || trade.counterpart_id === callerId;
  if (!isParticipant) return { ok: false, error: 'not-a-participant' };

  if (trade.state !== 'COMPLETED') return { ok: false, error: 'not-completed' };

  const counterparty =
    trade.initiator_id === callerId ? trade.counterpart_id : trade.initiator_id;
  if (counterparty !== revieweeId) {
    return { ok: false, error: 'invalid-reviewee' };
  }
  return { ok: true };
}

/**
 * Leave a review for the counterparty of a COMPLETED transaction (Phase 5).
 *
 * Authentication is required. The caller must have been a party to the
 * referenced cash sale / trade, the transaction must be COMPLETED, and
 * `revieweeId` must be the other party. The rating must be an integer 1..5 and
 * the comment (if any) at most 1000 chars. The review is inserted with
 * `reviewer_id = caller`; the DB unique constraint maps a second attempt to
 * `already-reviewed`. On success we best-effort notify the reviewee.
 */
export async function leaveReview(
  input: LeaveReviewInput,
): Promise<LeaveReviewResult> {
  const supabase = await createClient();

  const callerId = await getUserId(supabase);
  if (!callerId) return { ok: false, error: 'not-authenticated' };

  // Validate rating (integer 1..5) and comment length.
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return {
      ok: false,
      error: 'validation-error',
      message: 'Rating must be a whole number between 1 and 5.',
    };
  }

  const comment =
    typeof input.comment === 'string' ? input.comment.trim() : null;
  if (comment != null && comment.length > COMMENT_MAX) {
    return {
      ok: false,
      error: 'validation-error',
      message: `Comment must be ${COMMENT_MAX} characters or fewer.`,
    };
  }

  if (input.sourceType !== 'cash_sale' && input.sourceType !== 'trade') {
    return { ok: false, error: 'validation-error', message: 'Invalid source type.' };
  }

  // A caller can never review themselves.
  if (input.revieweeId === callerId) {
    return { ok: false, error: 'invalid-reviewee' };
  }

  // Verify the caller was a party to a COMPLETED transaction and that the
  // reviewee is the counterparty.
  const eligibility = await checkEligibility(
    supabase,
    callerId,
    input.revieweeId,
    input.sourceType,
    input.sourceId,
  );
  if (!eligibility.ok) {
    return { ok: false, error: eligibility.error };
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      reviewer_id: callerId,
      reviewee_id: input.revieweeId,
      rating,
      comment: comment && comment.length > 0 ? comment : null,
      source_type: input.sourceType,
      source_id: input.sourceId,
    })
    .select('*')
    .single();

  if (error || !data) {
    // 23505 = unique_violation → the caller already reviewed this transaction.
    if (error?.code === '23505') {
      return { ok: false, error: 'already-reviewed' };
    }
    return {
      ok: false,
      error: 'persistence-error',
      message: error?.message ?? 'Failed to save review.',
    };
  }

  // Best-effort: let the reviewee know they received a review. Never blocks the
  // happy path.
  await createNotification({
    userId: input.revieweeId,
    type: 'SYSTEM',
    title: 'You received a review',
    body: comment && comment.length > 0 ? comment : `Rated ${rating} out of 5.`,
    link: `/sellers/${input.revieweeId}`,
  });

  return { ok: true, data: data as ReviewRow };
}

// ---------------------------------------------------------------------------
// getReviewsFor
// ---------------------------------------------------------------------------

/**
 * How `userId` (the reviewee whose profile is being viewed) related to the
 * reviewer in the underlying transaction, so the UI can render "Bought item
 * from ___" / "Sold item to ___" / "Traded item with ___".
 */
export type ReviewTransactionKind = 'bought' | 'sold' | 'traded';

/** A review enriched with the reviewer's public display name, for the UI. */
export interface ReviewWithReviewer {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerId: string;
  reviewerName: string | null;
  /** The transaction kind, from the reviewee's perspective. */
  transactionKind: ReviewTransactionKind;
  /**
   * The transaction's value in AUD cents, when it can be determined: the
   * agreed item price for a cash sale, or the Fair_Market_Value of the goods
   * `userId` received for a trade (equal by design to what they gave up).
   * `null` if the source transaction could not be resolved.
   */
  valueCents: number | null;
}

/**
 * Public reviews written ABOUT `userId`, newest first, enriched with each
 * reviewer's public display name (via `public_profiles`), the transaction
 * kind (bought/sold/traded) from `userId`'s perspective, and the transaction
 * value. Reviews are publicly selectable under RLS, so this works for any
 * user.
 */
export async function getReviewsFor(
  userId: string,
): Promise<ReviewWithReviewer[]> {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at, reviewer_id, source_type, source_id')
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false });

  const rows = reviews ?? [];
  if (rows.length === 0) return [];

  const reviewerIds = Array.from(new Set(rows.map((r) => r.reviewer_id)));
  const cashSaleIds = Array.from(
    new Set(
      rows.filter((r) => r.source_type === 'cash_sale').map((r) => r.source_id),
    ),
  );
  const tradeIds = Array.from(
    new Set(rows.filter((r) => r.source_type === 'trade').map((r) => r.source_id)),
  );

  const [{ data: profiles }, { data: cashSales }, { data: tradeItems }] =
    await Promise.all([
      supabase.from('public_profiles').select('id, display_name').in('id', reviewerIds),
      cashSaleIds.length > 0
        ? supabase
            .from('cash_sales')
            .select('id, buyer_id, seller_id, agreed_price_cents')
            .in('id', cashSaleIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              buyer_id: string;
              seller_id: string;
              agreed_price_cents: number;
            }[],
          }),
      tradeIds.length > 0
        ? supabase
            .from('trade_items')
            .select('trade_id, trader_id, items(fmv_cents)')
            .in('trade_id', tradeIds)
        : Promise.resolve({
            data: [] as {
              trade_id: string;
              trader_id: string;
              items: { fmv_cents: number } | null;
            }[],
          }),
    ]);

  const nameById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  const cashSaleById = new Map((cashSales ?? []).map((s) => [s.id as string, s]));

  // For each trade, sum the Fair_Market_Value of the items the OTHER trader
  // contributed — that's what `userId` received, and by the equal-value trade
  // rule it matches what they gave up.
  const tradeValueByTradeId = new Map<string, number>();
  for (const row of tradeItems ?? []) {
    if (row.trader_id === userId) continue;
    const fmv = row.items?.fmv_cents ?? 0;
    tradeValueByTradeId.set(row.trade_id, (tradeValueByTradeId.get(row.trade_id) ?? 0) + fmv);
  }

  return rows.map((r) => {
    let transactionKind: ReviewTransactionKind = 'traded';
    let valueCents: number | null = null;

    if (r.source_type === 'cash_sale') {
      const sale = cashSaleById.get(r.source_id);
      transactionKind = sale?.seller_id === userId ? 'sold' : 'bought';
      valueCents = sale?.agreed_price_cents ?? null;
    } else {
      valueCents = tradeValueByTradeId.get(r.source_id) ?? null;
    }

    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      reviewerId: r.reviewer_id,
      reviewerName: nameById.get(r.reviewer_id) ?? null,
      transactionKind,
      valueCents,
    };
  });
}

// ---------------------------------------------------------------------------
// myReviewFor
// ---------------------------------------------------------------------------

/**
 * The caller's existing review for a specific transaction, or `null` when they
 * have not reviewed it yet (or are unauthenticated). Lets the UI show an
 * "already reviewed" state instead of the leave-review affordance.
 */
export async function myReviewFor(
  sourceType: ReviewSourceType,
  sourceId: string,
): Promise<ReviewRow | null> {
  const supabase = await createClient();

  const callerId = await getUserId(supabase);
  if (!callerId) return null;

  const { data } = await supabase
    .from('reviews')
    .select('*')
    .eq('reviewer_id', callerId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .maybeSingle();

  return (data as ReviewRow | null) ?? null;
}
