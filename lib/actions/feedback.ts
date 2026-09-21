'use server';

// lib/actions/feedback.ts
//
// Product intake (0120): a member telling us something about NoDitto itself — a bug, or
// a feature they want.
//
// WHY THIS IS NOT IN `lib/actions/reports.ts`. A report is moderation: it names a
// listing or a member, the console links to that target, and triage acts on it. Feedback
// has no target. Sharing the module would mean sharing the table, and 0120's header
// records why that is not merely untidy — 0094's `reports_one_open_per_reporter_target`
// index would cap a member at one open row for the life of their account.
//
// Thin, like every action here: authenticate, rate-limit, validate, insert, done. There
// is no orchestrator because there is no use case to orchestrate — nothing downstream
// reads a feedback row except a human. It notifies nobody and touches no money, which is
// also why it is not gated on the Identity_Gate: a buy-only member who has verified
// nothing is exactly the member most likely to hit a bug in onboarding.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import { feedbackLimiter } from '@/lib/rateLimiters';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  FEEDBACK_PATH_MAX,
} from '@/lib/marketplace-constants';
import type { Enums, Tables } from '@/lib/supabase/database.types';

/** A persisted feedback row. */
export type FeedbackRow = Tables<'feedback'>;

/** Which intake question the member is answering. */
export type FeedbackKind = Enums<'feedback_kind'>;

/**
 * Why a submission was refused.
 * - `not-authenticated` — no signed-in member.
 * - `rate-limited`      — too many submissions in the window.
 * - `validation-error`  — kind or message failed validation.
 * - `persistence-error` — the insert failed.
 */
export type SubmitFeedbackError =
  | 'not-authenticated'
  | 'rate-limited'
  | 'validation-error'
  | 'persistence-error';

/** What the caller needs back: enough to confirm, nothing more. */
export interface SubmitFeedbackData {
  id: string;
  kind: FeedbackKind;
}

/**
 * Narrow an arbitrary string to a {@link FeedbackKind}.
 *
 * Checked against `FEEDBACK_KINDS` rather than a literal union, so the dialog's options
 * and what this accepts cannot drift apart.
 */
function normalizeKind(value: string): FeedbackKind | null {
  const upper = (value ?? '').trim().toUpperCase();
  return FEEDBACK_KINDS.some((kind) => kind.value === upper)
    ? (upper as FeedbackKind)
    : null;
}

/**
 * Reduce a router path to what the column accepts, or `null`.
 *
 * STRIPS THE QUERY STRING AND HASH rather than storing them. They add nothing to
 * triage — `?tab=`, `?region=`, `?page=` are all re-derivable — and a path is the
 * smallest thing that answers "where were they". Anything that is not a path (a full
 * URL pasted in, say) is dropped entirely rather than coerced, because a wrong answer
 * here is worse than no answer: an operator would go looking at the wrong screen.
 */
function normalizePagePath(value: string | undefined | null): string | null {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('/')) return null;

  const path = raw.split(/[?#]/, 1)[0] ?? '';
  if (path.length === 0 || path.length > FEEDBACK_PATH_MAX) return null;
  return path;
}

/**
 * Validate and normalize a submission.
 *
 * Mirrored by the `feedback_message_length` CHECK in 0120 (enforce twice): the column
 * INSERT grant makes this row writable by anything holding the member's JWT, so these
 * bounds are advisory on their own.
 */
function validateFeedback(
  kind: string,
  message: string,
):
  | { ok: true; kind: FeedbackKind; message: string }
  | { ok: false; field: 'kind' | 'message'; message: string } {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) {
    return { ok: false, field: 'kind', message: 'Choose what kind of feedback this is.' };
  }

  const trimmed = (message ?? '').trim();
  if (trimmed.length < FEEDBACK_MESSAGE_MIN) {
    return {
      ok: false,
      field: 'message',
      message: `Please add a little more detail — at least ${FEEDBACK_MESSAGE_MIN} characters.`,
    };
  }
  if (trimmed.length > FEEDBACK_MESSAGE_MAX) {
    return {
      ok: false,
      field: 'message',
      message: `Please keep it to ${FEEDBACK_MESSAGE_MAX} characters or fewer.`,
    };
  }

  return { ok: true, kind: normalizedKind, message: trimmed };
}

/**
 * File a piece of feedback about NoDitto.
 *
 * Inserts through the COOKIE-BOUND client so RLS pins `author_id` to the caller — the
 * `author_id` passed here is checked against `auth.uid()` by `feedback_author_insert`,
 * not trusted. `status` is deliberately never sent: it is the queue's own column and the
 * member grant excludes it, so naming it would fail the insert outright. Same
 * arrangement, and the same reasoning, as `insertReport`.
 *
 * @param input.kind     One of {@link FEEDBACK_KINDS}.
 * @param input.message  What the member wants to say.
 * @param input.pagePath The route they were on, from the router. Optional.
 */
export async function submitFeedback(input: {
  kind: string;
  message: string;
  pagePath?: string | null;
}): Promise<ActionResult<SubmitFeedbackData, SubmitFeedbackError>> {
  const user = await getCachedAuthUser();
  if (!user) {
    return fail('not-authenticated', 'Please sign in to send feedback.');
  }

  // Keyed on the member, not the IP: the table has no uniqueness rule to lean on, by
  // design, so this is the only bound on how many rows one account can file.
  const { allowed } = await feedbackLimiter.check(await rateLimitIdentifier(user.id));
  if (!allowed) {
    return fail(
      'rate-limited',
      'That is a lot of feedback at once. Please wait a moment and try again.',
    );
  }

  const validated = validateFeedback(input.kind, input.message);
  if (!validated.ok) {
    return fail('validation-error', validated.message, validated.field);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      author_id: user.id,
      kind: validated.kind,
      message: validated.message,
      page_path: normalizePagePath(input.pagePath),
    })
    .select('id, kind')
    .single();

  if (error || !data) {
    return fail(
      'persistence-error',
      friendlyWriteFailure(error, 'We could not send your feedback. Please try again.'),
    );
  }

  // The admin console's Feedback tab and its tab badge both read this table.
  revalidatePath('/admin');

  return ok({ id: data.id, kind: data.kind });
}
