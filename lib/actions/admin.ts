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
// Every export is an async Server Action; shared shapes are `export type` only.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums } from '@/lib/supabase/database.types';

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
