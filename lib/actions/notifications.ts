'use server';

// lib/actions/notifications.ts
//
// Server Actions for the recipient-facing NOTIFICATION CENTER (Phase 4). These
// are THIN wrappers that authenticate the caller and operate through the
// cookie-bound Supabase client so RLS enforces the recipient-only access rules
// on the `notifications` table end-to-end (a user may only select / update /
// delete their own notifications; there is NO end-user insert policy — inserts
// happen server-side via the admin helper `createNotification`).
//
// Every export is an async Server Action; shared shapes are `export type` only
// (type exports are erased and permitted in a 'use server' module).

import { withActionLog } from '@/lib/errors/withActionLog';
import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { NOTIFICATIONS_DEFAULT_LIMIT } from '@/lib/marketplace-constants';
import type { Tables } from '@/lib/supabase/database.types';
import { parseContractLink, type ContractMove } from '@/lib/notifications/linkedContract';
import {
  describeLinkedRows,
  SALE_CONTRACT_SELECT,
  TRADE_CONTRACT_SELECT,
  TRADE_HOLDS_SELECT,
  type SaleContractRow,
  type TradeContractRow,
  type TradeHoldRow,
} from '@/lib/notifications/describeLinkedRows';

/**
 * A notification as the list renders it: the persisted row, plus three things read from
 * the contract it links to — whether it can still be opened, its subject where the row
 * named none, and what it is waiting on now. See {@link resolveContractLinks}.
 */
export type NotificationRow = Tables<'notifications'> & {
  target_missing?: boolean;
  contract_move?: ContractMove | null;
};

/**
 * Read the sale or trade each row links to: whether the caller can still open it, what
 * it is about, and whose move it is. The mapping is `describeLinkedRows`.
 *
 * GONE. A notification outlives what it points at: a contract can be removed, and RLS
 * hides one the caller is no longer party to. Following such a row landed on a 404 — the
 * first thing a seller tried with fifteen "New purchase request" rows was a dead page.
 * The row says "no longer available" in place instead of navigating.
 *
 * ABOUT WHAT (2026-11-28). A row whose producer named no card or member takes them from
 * the contract it links to (`lib/notifications/linkedContract.ts` says why, and what is
 * never filled).
 *
 * WHOSE MOVE (2026-11-28). The row also carries the contract's live step for its reader,
 * from the plan the contract room and the contract lists derive, so a notification about
 * something still waiting on you can say so, and one about a contract that has moved on
 * asks for nothing. It is never inferred from the notification's own words.
 *
 * ONE ROUND TRIP, the same number as before: the contract reads embed their subjects and
 * run beside the id checks and the holds a trade's plan needs. This runs on every page,
 * because the header seeds the bell with it. The id checks stay separate so a failed
 * embed costs only the subject and the move, never the "gone" verdict.
 */
async function resolveContractLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: NotificationRow[],
): Promise<NotificationRow[]> {
  const saleIds = new Set<string>();
  const tradeIds = new Set<string>();
  for (const row of rows) {
    const link = parseContractLink(row.link);
    if (link) (link.kind === 'sale' ? saleIds : tradeIds).add(link.id);
  }
  if (saleIds.size === 0 && tradeIds.size === 0) return rows;

  const none = Promise.resolve({ data: [] as { id: string }[], error: null });
  const [sales, trades, saleContracts, tradeContracts, holds] = await Promise.all([
    saleIds.size > 0 ? supabase.from('cash_sales').select('id').in('id', [...saleIds]) : none,
    tradeIds.size > 0 ? supabase.from('trades').select('id').in('id', [...tradeIds]) : none,
    saleIds.size > 0
      ? supabase.from('cash_sales').select(SALE_CONTRACT_SELECT).in('id', [...saleIds])
      : none,
    tradeIds.size > 0
      ? supabase.from('trades').select(TRADE_CONTRACT_SELECT).in('id', [...tradeIds])
      : none,
    tradeIds.size > 0
      ? supabase.from('pre_auth_holds').select(TRADE_HOLDS_SELECT).in('trade_id', [...tradeIds])
      : none,
  ]);

  return describeLinkedRows(rows, {
    liveIds:
      sales.error || trades.error
        ? null
        : new Set(
            [...(sales.data ?? []), ...(trades.data ?? [])].map((row) => row.id.toLowerCase()),
          ),
    sales: saleContracts.error
      ? null
      : ((saleContracts.data ?? []) as unknown as SaleContractRow[]),
    trades: tradeContracts.error
      ? null
      : ((tradeContracts.data ?? []) as unknown as TradeContractRow[]),
    holds: holds.error ? null : ((holds.data ?? []) as unknown as TradeHoldRow[]),
  });
}

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/**
 * Resolve the current authenticated user id, or `null`.
 *
 * Reads through the request-cached lookup rather than `client.auth.getUser()`.
 * The site header lists notifications on every page, so this ran once per
 * navigation on top of the header's own auth read.
 */
async function getUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// listMyNotifications
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link listMyNotifications}. */
export type ListNotificationsError = 'unauthenticated' | 'persistence-error';

/** Result of {@link listMyNotifications}. */
export type ListMyNotificationsResult =
  | { ok: true; notifications: NotificationRow[] }
  | ActionFailure<ListNotificationsError>;

/**
 * List the caller's notifications, newest-first, capped at `limit` (default
 * {@link NOTIFICATIONS_DEFAULT_LIMIT}). RLS scopes the read to the recipient.
 */
export const listMyNotifications = withActionLog('notifications.listMyNotifications', async function listMyNotifications(
  limit: number = NOTIFICATIONS_DEFAULT_LIMIT,
): Promise<ListMyNotificationsResult> {
  const supabase = await createClient();

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };

  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 200)
      : NOTIFICATIONS_DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  return {
    ok: true,
    notifications: await resolveContractLinks(supabase, (data ?? []) as NotificationRow[]),
  };
});

// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link markNotificationRead}. */
export type MarkReadError = 'unauthenticated' | 'persistence-error';

/** Result of {@link markNotificationRead}. */
export type MarkNotificationReadResult =
  | { ok: true }
  | ActionFailure<MarkReadError>;

/**
 * Mark a single notification read (`read_at = now()`). RLS scopes the update to
 * the caller's own rows, so marking someone else's notification affects nothing.
 * Already-read rows are left unchanged (the `read_at IS NULL` guard).
 */
export const markNotificationRead = withActionLog('notifications.markNotificationRead', async function markNotificationRead(
  id: string,
): Promise<MarkNotificationReadResult> {
  const supabase = await createClient();

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  return { ok: true };
});

// ---------------------------------------------------------------------------
// markAllNotificationsRead
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link markAllNotificationsRead}. */
export type MarkAllReadError = 'unauthenticated' | 'persistence-error';

/** Result of {@link markAllNotificationsRead}: number of rows updated. */
export type MarkAllNotificationsReadResult =
  | { ok: true; updated: number }
  | ActionFailure<MarkAllReadError>;

/**
 * Mark every unread notification for the caller as read. RLS scopes the update
 * to the caller's rows; returns the number of notifications updated.
 */
export const markAllNotificationsRead = withActionLog('notifications.markAllNotificationsRead', async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResult> {
  const supabase = await createClient();

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  return { ok: true, updated: (data ?? []).length };
});
