import 'server-only';

// lib/notifications/createNotification.ts
//
// Server-only helper for EMITTING in-app notifications (Phase 4). Notifications
// are inserted with the SERVICE-ROLE admin client because the `notifications`
// table has NO insert policy for end users - only the recipient may select /
// update / delete their rows (RLS). Emitting therefore happens on the trusted
// server via the admin client, which bypasses RLS.
//
// This module carries the `server-only` import so it can never be bundled into
// client code, and it is intentionally NOT a `'use server'` module: that keeps
// it an ordinary server function that other server actions import and call,
// rather than a client-callable action endpoint (which would let a caller forge
// notifications for arbitrary users).
//
// The helper is BEST-EFFORT: it must never throw into the caller's happy path,
// so a failed emit is swallowed (and logged) rather than surfaced. Emitting a
// notification is a side effect of a successful mutation, never a precondition.

import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums } from '@/lib/supabase/database.types';

/** The notification kind enum. */
export type NotificationType = Enums<'notification_type'>;

/** Arguments for {@link createNotification}. */
export interface CreateNotificationInput {
  /** The recipient user id. */
  userId: string;
  /** The notification kind (OFFER / MESSAGE / TRADE / SALE / SYSTEM). */
  type: NotificationType;
  /** Short headline shown in the bell / list. */
  title: string;
  /** Optional secondary line. */
  body?: string | null;
  /** Optional in-app link the notification navigates to when clicked. */
  link?: string | null;
}

/**
 * Insert a notification for `userId` via the service-role admin client
 * (bypassing RLS). Best-effort: returns `true` on success and `false` on any
 * failure, never throwing, so callers can emit after a successful mutation
 * without risking the main flow.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<boolean> {
  try {
    if (!input.userId || !input.title) return false;

    const admin = createAdminClient();
    const { error } = await admin.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });

    if (error) {
      console.error('[createNotification] failed to insert notification', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[createNotification] unexpected error', e);
    return false;
  }
}
