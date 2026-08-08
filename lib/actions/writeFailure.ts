import 'server-only';

// lib/actions/writeFailure.ts
//
// Turns a Postgres/PostgREST error into something a member can act on.
//
// WHY THIS EXISTS. Write paths repeatedly did `fail('UPDATE_FAILED', error.message)`,
// which puts the driver's own words on screen. The one that prompted this was
// PostgREST's `PGRST116`:
//
//     Cannot coerce the result to a single JSON object
//
// A member read that in a toast during onboarding. It names an internal
// serialisation concern, suggests nothing to do about it, and — worst of all — it
// was reported for a condition the app could have handled: `.single()` had matched
// zero rows because the member had no profile row. The message described the
// driver's disappointment rather than the member's situation.
//
// The rule this encodes: an expected database outcome gets member-facing copy, and
// the raw text is kept for the server log where it is actually useful. Nothing here
// invents reassurance — an unrecognised failure still says that something went wrong
// and that retrying is the next move.

/** Shape shared by `postgrest-js` errors; avoids importing the driver's types here. */
export interface DriverError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Codes worth translating individually. Everything else falls through to the
 * generic message, deliberately: a guessed explanation is worse than an honest
 * "that did not work".
 */
const MEMBER_FACING: Record<string, string> = {
  // PostgREST: `.single()` matched zero rows, or more than one.
  PGRST116:
    'We could not find your account details. Please reload the page and try again.',
  // PostgREST: the schema cache has no such relationship/column.
  PGRST200: 'Something on our side is misconfigured. Please try again shortly.',
  // Postgres: unique violation.
  '23505': 'That value is already taken. Please choose another.',
  // Postgres: foreign key violation.
  '23503': 'Something this depends on no longer exists. Please reload and try again.',
  // Postgres: not-null violation.
  '23502': 'Something required was missing. Please fill in every field and try again.',
  // Postgres: check constraint.
  '23514': 'Some of those details are not valid. Please review them and try again.',
  // Postgres: insufficient privilege — an RLS policy or column grant refused this.
  '42501': 'You do not have permission to change that.',
};

const GENERIC = 'Something went wrong on our side. Please try again.';

/**
 * Map a driver error to copy safe to show a member.
 *
 * Pass the whole error rather than `error.message` so the code can be consulted;
 * the message alone is exactly what should not be surfaced. `fallback` lets a call
 * site keep copy specific to what it was doing ("Failed to save review") for the
 * failures this cannot usefully translate.
 *
 * Note the precedence, because the bug being fixed had it inverted. Call sites read
 * `error?.message ?? 'Failed to create item'`, which shows the driver's words
 * whenever there IS an error and the readable copy only when there is not — so the
 * human sentence was unreachable in exactly the case it was written for.
 */
export function friendlyWriteFailure(
  error: DriverError | null | undefined,
  fallback: string = GENERIC,
): string {
  if (!error) {
    return fallback;
  }
  const code = error.code ?? '';
  return MEMBER_FACING[code] ?? fallback;
}

/**
 * True when the error is PostgREST reporting that `.single()` found no row.
 *
 * Useful for deciding to CREATE the missing row instead of reporting a failure —
 * which is what onboarding now does.
 */
export function isNoRowsError(error: DriverError | null | undefined): boolean {
  return (error?.code ?? '') === 'PGRST116';
}
