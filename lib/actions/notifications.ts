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

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { NOTIFICATIONS_DEFAULT_LIMIT } from '@/lib/marketplace-constants';
import type { Tables } from '@/lib/supabase/database.types';

/** A persisted notification row. */
export type NotificationRow = Tables<'notifications'>;

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
export async function listMyNotifications(
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

  return { ok: true, notifications: (data ?? []) as NotificationRow[] };
}

// ---------------------------------------------------------------------------
// unreadNotificationCount
// ---------------------------------------------------------------------------

/**
 * Count the caller's unread notifications (`read_at IS NULL`). Returns `0` when
 * unauthenticated or on any read error so the UI can render a badge safely.
 */
export async function unreadNotificationCount(): Promise<number> {
  const supabase = await createClient();

  const me = await getUserId();
  if (!me) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error || count == null) return 0;
  return count;
}

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
export async function markNotificationRead(
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
}

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
export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResult> {
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
}
