// tests/e2e/support/marker.ts
//
// Every row a spec creates must be identifiable as test data so
// scripts/e2e/cleanup-test-data.ts can find and remove it by this marker alone
// — not by tracking IDs in memory, which a crashed run would lose. The 5+2
// seeded fixture users/items never match this prefix, so cleanup can never
// touch them by mistake.
//
// It also owns the RUN ID (`runId()`), the one value that names a run across the
// artifact directories, the upload ledger, the run manifest and the Stripe metadata
// the app stamps (`cardtrade_e2e_run`, read from `E2E_RUN_ID`).

import { randomBytes } from 'node:crypto';
import { isRunId } from '../audit/core/artifactPaths';

export const E2E_MARKER = '[E2E]';

/** Prefix a listing title / display name so cleanup can find it later. */
export function marked(base: string): string {
  return `${E2E_MARKER} ${base}`;
}

/**
 * A unique, marked email for specs that sign up a brand-new account. `example.com`
 * is reserved by RFC 2606, and cleanup deletes an auth user only when it matches
 * `e2e-…@example.com` and carries `app_metadata.sandbox = true` (Req 2.1).
 */
export function markedEmail(label: string): string {
  return `e2e-${label}-${Date.now()}@example.com`;
}

/** The environment variable a run id travels in, to the app servers and workers. */
export const RUN_ID_ENV = 'E2E_RUN_ID';

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 7;

function randomSuffix(): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  let out = '';
  for (const byte of bytes) out += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
  return out;
}

/**
 * A new run id for a run starting at `startedAt`: the UTC timestamp to the second
 * with `-` for `:`, then a lowercase suffix, e.g. `2026-12-01T09-30-00Z-a1b2c3d`.
 * Matches `RUN_ID_PATTERN` in `audit/core/artifactPaths.ts`, whose fixed-width
 * timestamp makes string order the same as start-time order.
 *
 * @throws RangeError when `startedAt` is not a valid date or `suffix` is not
 *   lowercase letters and digits
 */
export function newRunId(startedAt: Date = new Date(), suffix: string = randomSuffix()): string {
  if (Number.isNaN(startedAt.getTime())) {
    throw new RangeError('newRunId: invalid start time');
  }
  const stamp = `${startedAt.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
  const id = `${stamp}-${suffix}`;
  if (!isRunId(id)) {
    throw new RangeError(`newRunId: ${JSON.stringify(id)} is not a valid run id`);
  }
  return id;
}

/**
 * The id of the current run.
 *
 * Read from `E2E_RUN_ID` when it is set, so the entry point, the Playwright config,
 * every worker and both app servers agree on one value. When it is unset (a bare
 * `npx playwright test`), a new id is generated once and written back to
 * `process.env`, so worker processes spawned afterwards inherit the same one.
 *
 * @throws Error when `E2E_RUN_ID` is set to something that is not a run id, because
 *   every artifact path built from it would then be refused one at a time
 */
export function runId(): string {
  const existing = process.env[RUN_ID_ENV]?.trim();
  if (existing) {
    if (!isRunId(existing)) {
      throw new Error(
        `${RUN_ID_ENV} is set but is not a run id (expected e.g. 2026-12-01T09-30-00Z-a1b2c3d).`,
      );
    }
    return existing;
  }
  const generated = newRunId();
  process.env[RUN_ID_ENV] = generated;
  return generated;
}
