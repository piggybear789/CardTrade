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

/** The sides a deal creator can be on. */
export const DEAL_ROLES = ['BUYER', 'SELLER', 'TRADER'] as const;

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
