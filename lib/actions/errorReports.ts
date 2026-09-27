'use server';

// lib/actions/errorReports.ts
//
// "Report this problem" on the error screen (0123). A member chose to send it, so it is
// saved in every environment, unlike the automatic capture that is production-only.
//
// OPEN TO GUESTS, deliberately. A guest who hits a broken listing page is exactly who
// we want to hear from, so this does not require sign-in; it is rate-limited by member
// or IP instead, and writes through the service role because the table has no member
// or anon grant. When a member IS signed in, their id comes from the session, never
// from the caller.
//
// NOT wrapped in `withActionLog`, unlike every other action module: a report that fails
// to save would only try to log itself into the same table. Browser errors are not
// recorded through a Server Action at all — see `app/api/errors/route.ts`, which works
// even before the app has hydrated.

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { errorReportLimiter } from '@/lib/rateLimiters';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { ERROR_NOTE_MAX, normalizeReference } from '@/domain/errors/errorLog';
import { writeErrorLog } from '@/lib/errors/errorLog';

export type ReportErrorError = 'validation-error' | 'rate-limited' | 'persistence-error';

/**
 * File a member's report about the error they are looking at.
 *
 * @param input.reference The "Ref" on the error screen: a digest or a browser id.
 * @param input.note      What they were doing. Optional.
 * @param input.path      The route they were on.
 */
export async function reportError(input: {
  reference: string;
  note?: string | null;
  path?: string | null;
}): Promise<ActionResult<{ reference: string }, ReportErrorError>> {
  const reference = normalizeReference(input?.reference);
  if (!reference) {
    return fail('validation-error', 'This error has no reference to report against.');
  }
  if (typeof input.note === 'string' && input.note.trim().length > ERROR_NOTE_MAX) {
    return fail(
      'validation-error',
      `Please keep it to ${ERROR_NOTE_MAX} characters or fewer.`,
      'note',
    );
  }

  let profileId: string | null = null;
  try {
    profileId = (await getCachedAuthUser())?.id ?? null;
  } catch {
    // A guest, or a broken session: the report is still worth having.
  }

  const { allowed } = await errorReportLimiter.check(await rateLimitIdentifier(profileId));
  if (!allowed) {
    return fail('rate-limited', 'You have sent a few reports already. Try again in a few minutes.');
  }

  const saved = await writeErrorLog({
    source: 'REPORT',
    reference,
    note: input.note,
    path: input.path,
    profileId,
  });
  if (!saved) {
    return fail('persistence-error', 'The report did not send. Try again in a moment.');
  }

  return ok({ reference });
}
