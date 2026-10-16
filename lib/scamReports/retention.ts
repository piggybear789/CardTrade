import 'server-only';

// lib/scamReports/retention.ts
//
// The `:17` job's scam-report pass (scam-reports spec, Req 6.6 and 9):
//
//   1. RETENTION. A report dismissed or withdrawn more than 90 days ago is deleted
//      with its screenshots and any response photos. Its fingerprints and matches go
//      with it (`on delete cascade`). Live reports are never deleted by age.
//   2. BACKFILL. Members with no match keys yet (new sign-ups, and everyone from
//      before 0154) get them, a bounded batch per run.
//
// A report whose photos cannot be removed is left for the next run rather than
// deleted, so no evidence object is ever orphaned in the bucket.

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { backfillMemberMatchKeys } from '@/lib/risk/scamMatching';
import { removeScamEvidence } from '@/lib/storage/scamReportEvidence';
import { SCAM_REPORT_LIMITS } from '@/domain/risk/scamReportVocabulary';

type AdminClient = ReturnType<typeof createAdminClient>;

/** Reports deleted per run. The rest wait an hour. */
const DELETE_BATCH = 100;

/** Delete closed reports past the retention window. */
export async function deleteExpiredScamReports(
  now: Date = new Date(),
  client: AdminClient = createAdminClient(),
): Promise<{ deleted: number; skipped: number }> {
  const cutoff = new Date(now.getTime() - SCAM_REPORT_LIMITS.deleteDismissedAfterDays * 86_400_000).toISOString();
  const { data: reports, error } = await client
    .from('scam_reports')
    .select('id, evidence_paths, dismissed_at, withdrawn_at')
    .in('status', ['DISMISSED', 'WITHDRAWN'])
    .or(`dismissed_at.lt."${cutoff}",withdrawn_at.lt."${cutoff}"`)
    .limit(DELETE_BATCH);
  if (error) throw error;

  let deleted = 0;
  let skipped = 0;
  for (const report of reports ?? []) {
    // `coalesce(dismissed_at, withdrawn_at)`: whichever closed it.
    const closedAt = report.dismissed_at ?? report.withdrawn_at;
    if (!closedAt || closedAt >= cutoff) continue;

    const { data: matches, error: matchError } = await client
      .from('scam_report_matches')
      .select('member_response_paths')
      .eq('report_id', report.id);
    if (matchError) {
      skipped++;
      continue;
    }
    const paths = [
      ...(report.evidence_paths ?? []),
      ...(matches ?? []).flatMap((match) => match.member_response_paths ?? []),
    ];
    const storageError = await removeScamEvidence(client, paths);
    if (storageError) {
      skipped++;
      await logBackgroundFailure({
        name: 'scamReports.retention',
        errorCode: 'EVIDENCE_REMOVE_FAILED',
        error: new Error(storageError),
        context: { reportId: report.id },
      });
      continue;
    }

    const { error: deleteError } = await client.from('scam_reports').delete().eq('id', report.id);
    if (deleteError) {
      skipped++;
      await logBackgroundFailure({
        name: 'scamReports.retention',
        errorCode: 'REPORT_DELETE_FAILED',
        error: deleteError,
        context: { reportId: report.id },
      });
      continue;
    }
    deleted++;
  }
  return { deleted, skipped };
}

/** The whole pass: retention first, then the match-key backfill. */
export async function sweepScamReports(): Promise<{
  deleted: number;
  skipped: number;
  refreshed: number;
}> {
  const client = createAdminClient();
  const retention = await deleteExpiredScamReports(new Date(), client);
  const backfill = await backfillMemberMatchKeys(200, client);
  return { ...retention, ...backfill };
}
