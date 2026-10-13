// lib/identity/personKeyBackfill.ts
//
// Backfill the person keys a verification came back without (ESC-15).
//
// Stripe returns a session's document number to the restricted Identity key for 48
// hours only. A member verified while that key was missing or a read failed is marked
// `identity_keys_missing_at`; this pass, run inside the `:17` job, re-reads each such
// session within the window and stamps the keys through the one identity writer, so
// the ban check runs on them too. Past 48 hours the marker stays as a record and the
// member is listed for staff.
//
// `server-only`, not a Server Action.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { regionForProfile } from '@/lib/regionBinding';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { applyIdentityDecision } from './applyIdentityDecision';

/** Stripe's window for reading sensitive verified outputs. */
export const PERSON_KEY_WINDOW_HOURS = 48;
const MAX_PER_PASS = 25;

export async function backfillPersonKeys(): Promise<{ backfilled: number; stillMissing: number }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - PERSON_KEY_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await admin
    .from('profiles')
    .select('id, identity_check_session_id')
    .not('identity_keys_missing_at', 'is', null)
    .gte('identity_keys_missing_at', since)
    .not('identity_check_session_id', 'is', null)
    .limit(MAX_PER_PASS);
  if (error) {
    await logBackgroundFailure({ name: 'identity.person_keys', errorCode: 'READ_FAILED', message: error.message });
    return { backfilled: 0, stillMissing: 0 };
  }

  let backfilled = 0;
  let stillMissing = 0;
  for (const row of (data ?? []) as Array<{ id: string; identity_check_session_id: string }>) {
    try {
      const payments = getPaymentService(await regionForProfile(row.id));
      if (!payments.readIdentityCheck) continue;
      const check = await payments.readIdentityCheck(row.identity_check_session_id);
      if (check.outcome !== 'VERIFIED' || check.personKeysUnavailable) {
        stillMissing += 1;
        continue;
      }
      // The one writer: stamps the keys, runs the ban check, clears the marker.
      await applyIdentityDecision({ profileId: row.id, check });
      backfilled += 1;
    } catch (err) {
      stillMissing += 1;
      await logBackgroundFailure({
        name: 'identity.person_keys',
        errorCode: 'THREW',
        error: err,
        context: { profileId: row.id },
      });
    }
  }
  return { backfilled, stillMissing };
}
