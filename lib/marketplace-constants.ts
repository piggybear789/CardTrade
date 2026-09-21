// lib/marketplace-constants.ts
//
// Plain (non-'use server') shared constants for marketplace features. These live
// outside the Server Action modules because a "use server" file may ONLY export
// async functions — exporting runtime constants from one is a Next.js error.
// Both server actions and client components import these values from here.

/** Inclusive bounds for an offer amount, in integer AUD cents. */
export const OFFER_AMOUNT_MIN = 1;
export const OFFER_AMOUNT_MAX = 99_999_999_999;

/** Message body length bounds (Unicode code points, trimmed). */
export const MESSAGE_BODY_MIN = 1;
export const MESSAGE_BODY_MAX = 4000;

/** Report reason (short label) + optional details bounds. */
export const REASON_MIN = 1;
export const REASON_MAX = 100;
export const DETAILS_MAX = 1000;

/**
 * Member feedback about NoDitto itself (0120): bug reports and feature ideas.
 *
 * A REAL LOWER BOUND, unlike `REASON_MIN`. A report carries a chosen reason and a
 * target, so its free text can be empty and the row still means something. Feedback is
 * nothing BUT the free text — "no" or "broken" is a row an operator cannot act on, and
 * an inbox of them is an inbox that stops being read.
 *
 * Mirrored by the `feedback_message_length` CHECK in migration 0120; change both.
 */
export const FEEDBACK_MESSAGE_MIN = 10;
export const FEEDBACK_MESSAGE_MAX = 2000;

/**
 * Cap on the captured route. Mirrors the `feedback_page_path_shape` CHECK.
 *
 * Generous because it is never typed by a member — it comes from the router — so the
 * only thing it guards against is an absurd path, not a mistake someone could make.
 */
export const FEEDBACK_PATH_MAX = 512;

/**
 * The `feedback_kind` values, in the order the dialog offers them, each with the label a
 * member reads.
 *
 * HERE RATHER THAN IN `lib/actions/feedback.ts` because that module is `'use server'`
 * and may only export async functions — a const there is a build error, not a style
 * preference. The dialog and the validator both read this, so a new kind is one edit
 * plus the enum in a migration.
 *
 * The values are the enum labels verbatim; a typo would compile and then fail at the
 * database, because the enum check happens there.
 */
export const FEEDBACK_KINDS = [
  { value: 'BUG', label: 'Something is broken' },
  { value: 'IDEA', label: 'I have a feature idea' },
  { value: 'OTHER', label: 'Something else' },
] as const;

/** A member-submitted feedback category. Mirrors the `cardtrade.feedback_kind` enum. */
export type FeedbackKindValue = (typeof FEEDBACK_KINDS)[number]['value'];

/** Default page size for the notifications list. */
export const NOTIFICATIONS_DEFAULT_LIMIT = 30;

// ---------------------------------------------------------------------------
// Private 1:1 binding deals ("deal room")
// ---------------------------------------------------------------------------

/** Deal title length bounds (trimmed). */
export const DEAL_TITLE_MIN = 3;
export const DEAL_TITLE_MAX = 120;

/** Free-text bounds for deal descriptions, item text, and handover details. */
export const DEAL_TEXT_MAX = 2000;

/** Bounds for a deal's optional cash component, in integer AUD cents. */
export const DEAL_CASH_MIN = 1;
export const DEAL_CASH_MAX = 99_999_999_999;

/**
 * Collateral fallback for the binding-contract (escrow) step, in integer AUD
 * cents. When a deal specifies neither `collateral_cents` nor a
 * `cash_amount_cents` to size the hold from, each party is held for this
 * default ($100) — enough to be a meaningful commitment for a pure swap while
 * staying predictable for the parties.
 */
export const DEAL_DEFAULT_COLLATERAL_CENTS = 10_000;

/** Bounds for an explicit per-party collateral amount, in integer AUD cents. */
export const DEAL_COLLATERAL_MIN = 100;
export const DEAL_COLLATERAL_MAX = 99_999_999_999;

/** Reason/detail length cap on decline, cancel, and dispute actions. */
export const DEAL_REASON_MAX = 500;

/**
 * Photo bounds for goods either deal participant puts up. At least one photo is
 * required whenever a participant describes goods — these photos are the
 * evidence base if the deal is later arbitrated.
 */
export const DEAL_PHOTOS_MIN = 1;
export const DEAL_PHOTOS_MAX = 10;

/**
 * Bounds for a DELIVERY handover's postage cost, in integer AUD cents. Priced
 * separately from the deal's cash component and charged on top of it; `0` is a
 * valid answer (free delivery).
 */
export const DEAL_DELIVERY_COST_MIN = 0;
export const DEAL_DELIVERY_COST_MAX = 99_999_999_999;

/** What a TRADER creator can put up. `ITEMS` requires photos. */
export const DEAL_OFFER_KINDS = ['CARDS', 'CASH', 'ITEMS'] as const;

/** The `deal_events.event` value logged once per party when marking complete. */
export const DEAL_EVENT_COMPLETE_MARKED = 'COMPLETE_MARKED';

// ---------------------------------------------------------------------------
// 2-Way Trade proposals (counterpart acceptance)
// ---------------------------------------------------------------------------

/**
 * Cap on the optional note a Trader attaches to a Trade offer. Matches the
 * `trade_proposals_message_length` check in
 * `supabase/migrations/0014_trade_proposals.sql`.
 */
export const TRADE_PROPOSAL_MESSAGE_MAX = 2000;


/**
 * Bounds for a dispute claim — the raiser's own account of what went wrong.
 *
 * Mirrors the CHECK constraints on `cash_sales.dispute_reason` and
 * `trades.dispute_reason` (0083). Both flows use the same numbers deliberately: a
 * dispute reads the same in either room, so it must be bounded the same in both.
 */
export const DISPUTE_REASON_MIN = 10;
export const DISPUTE_REASON_MAX = 2000;
