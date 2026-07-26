'use server';

// lib/actions/reports.ts
//
// Server Actions for community reporting (Phase 6). Any authenticated user can
// flag an item or another user for moderator review. Reports are inserted via
// the cookie-bound client so RLS enforces `reporter_id = auth.uid()` on insert
// and scopes reads to the reporter (admins additionally see all rows).
//
// These are best-effort: a report never emits a notification and never mutates
// the target - triage happens later in the admin console. Every export is an
// async Server Action; shared shapes are `export type` only.

import { createClient } from '@/lib/supabase/server';
import { REASON_MIN, REASON_MAX, DETAILS_MAX } from '@/lib/marketplace-constants';
import type { Tables } from '@/lib/supabase/database.types';

/** A persisted report row as returned to callers. */
export type ReportRow = Tables<'reports'>;

/** What a report targets. */
export type ReportTargetType = 'item' | 'user';



/**
 * Report action error codes.
 * - `not-authenticated` - no signed-in user.
 * - `validation-error`  - reason/details failed validation.
 * - `self-report`       - the caller tried to report their own listing/self.
 * - `not-found`         - the target item does not exist.
 * - `persistence-error` - the database insert failed.
 */
export type ReportActionError =
  | 'not-authenticated'
  | 'validation-error'
  | 'self-report'
  | 'not-found'
  | 'persistence-error';

/** Discriminated result returned by every report action. */
export type ReportActionResult =
  | { ok: true; data: ReportRow }
  | {
      ok: false;
      error: ReportActionError;
      /** For `validation-error`: the offending field. */
      field?: 'reason' | 'details';
      /** Human-readable detail for surfacing inline. */
      message?: string;
    };

/** Validate + normalize the reason/details pair shared by both report kinds. */
function validateReport(
  reason: string,
  details?: string,
):
  | { ok: true; reason: string; details: string | null }
  | { ok: false; field: 'reason' | 'details'; message: string } {
  const trimmedReason = (reason ?? '').trim();
  if (trimmedReason.length < REASON_MIN || trimmedReason.length > REASON_MAX) {
    return {
      ok: false,
      field: 'reason',
      message: `A reason between ${REASON_MIN} and ${REASON_MAX} characters is required.`,
    };
  }

  const trimmedDetails = (details ?? '').trim();
  if (trimmedDetails.length > DETAILS_MAX) {
    return {
      ok: false,
      field: 'details',
      message: `Details must be ${DETAILS_MAX} characters or fewer.`,
    };
  }

  return {
    ok: true,
    reason: trimmedReason,
    details: trimmedDetails.length > 0 ? trimmedDetails : null,
  };
}

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/** Insert a validated report of the given kind on behalf of the caller. */
async function insertReport(
  targetType: ReportTargetType,
  targetId: string,
  reporterId: string,
  reason: string,
  details: string | null,
): Promise<ReportActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: reporterId,
      target_type: targetType,
      target_id: targetId,
      reason,
      details,
      status: 'OPEN',
    })
    .select('*')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: 'persistence-error',
      message: error?.message ?? 'Failed to submit report.',
    };
  }

  return { ok: true, data: data as ReportRow };
}

/**
 * Report an Item for moderator review. Requires an authenticated user and
 * rejects reporting your own listing (`self-report`).
 */
export async function reportItem(
  itemId: string,
  reason: string,
  details?: string,
): Promise<ReportActionResult> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, error: 'not-authenticated' };
  }

  const validated = validateReport(reason, details);
  if (!validated.ok) {
    return {
      ok: false,
      error: 'validation-error',
      field: validated.field,
      message: validated.message,
    };
  }

  // Resolve the item's owner to block self-reports. RLS exposes AVAILABLE rows
  // publicly, so a missing row here means the item is not visible/does not
  // exist.
  const { data: item } = await supabase
    .from('items')
    .select('owner_id')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) {
    return { ok: false, error: 'not-found' };
  }
  if (item.owner_id === userId) {
    return {
      ok: false,
      error: 'self-report',
      message: 'You cannot report your own listing.',
    };
  }

  return insertReport('item', itemId, userId, validated.reason, validated.details);
}

/**
 * Report a User for moderator review. Requires an authenticated user and
 * rejects reporting yourself (`self-report`).
 */
export async function reportUser(
  userId: string,
  reason: string,
  details?: string,
): Promise<ReportActionResult> {
  const supabase = await createClient();

  const callerId = await getUserId(supabase);
  if (!callerId) {
    return { ok: false, error: 'not-authenticated' };
  }

  if (userId === callerId) {
    return {
      ok: false,
      error: 'self-report',
      message: 'You cannot report yourself.',
    };
  }

  const validated = validateReport(reason, details);
  if (!validated.ok) {
    return {
      ok: false,
      error: 'validation-error',
      field: validated.field,
      message: validated.message,
    };
  }

  return insertReport('user', userId, callerId, validated.reason, validated.details);
}
