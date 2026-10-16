'use server';

// lib/actions/scamReports.ts
//
// The member's half of off-platform scam reports (scam-reports spec): filing a report,
// withdrawing it, and responding when a report matched your account.
//
// Everything writes through the service role, because the 0154 tables carry no member
// grant. Each action checks who is asking before it touches a row.
//
// WHAT THE REPORTER LEARNS. Only that the report was received. Nothing here tells them
// whether anyone matched, which is the line that keeps a report from becoming a way to
// test whether a given person is on NoDitto.

import { revalidatePath } from 'next/cache';

import { withActionLog } from '@/lib/errors/withActionLog';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { findMatchesForReport, scamFingerprintSecret } from '@/lib/risk/scamMatching';
import {
  createSignedScamEvidenceUpload,
  existingScamEvidence,
} from '@/lib/storage/scamReportEvidence';
import {
  SCAM_REPORT_LIMITS,
  expandIdentifier,
  identifierHash,
  maskIdentifier,
  validateScamReport,
  type ScamReportInput,
} from '@/domain/risk/scamReports';
import { type ActionResult, fail, ok } from './result';

export type ScamReportError =
  | 'not-authenticated'
  /** Only ID-verified members can report. */
  | 'identity-unverified'
  | 'not-allowed'
  | 'rate-limited'
  | 'invalid-report'
  | 'not-found'
  | 'persistence-error';

const SAVE_FAILED = "We couldn't save your report. Please try again.";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Mint a write token for one evidence photo, under the caller's own folder. Used by
 * reporters and by members answering a match staff told them about.
 */
export const createScamEvidenceUpload = withActionLog('scamReports.createScamEvidenceUpload', async function createScamEvidenceUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ScamReportError>> {
  const userId = await currentUserId();
  if (!userId) return fail('not-authenticated', 'Sign in to add photos.');

  const admin = createAdminClient();
  try {
    return ok(await createSignedScamEvidenceUpload(admin, userId, contentType));
  } catch (error) {
    return fail('persistence-error', error instanceof Error ? error.message : 'Could not prepare the upload.');
  }
});

/** File a scam report. ID-verified members only, 3 per 30 days. */
export const submitScamReport = withActionLog('scamReports.submitScamReport', async function submitScamReport(
  input: ScamReportInput,
): Promise<ActionResult<{ id: string }, ScamReportError>> {
  const userId = await currentUserId();
  if (!userId) return fail('not-authenticated', 'Sign in to report a scam.');

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('identity_check_status, fraud_banned_at, closed_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) return fail('persistence-error', SAVE_FAILED);
  if (profile.fraud_banned_at || profile.closed_at) {
    return fail('not-allowed', 'This account can’t file reports.');
  }
  if (profile.identity_check_status !== 'VERIFIED') {
    return fail('identity-unverified', 'Verify your ID before filing a report, so we know reports come from real people.');
  }

  const since = new Date(Date.now() - SCAM_REPORT_LIMITS.windowDays * 86_400_000).toISOString();
  const { count, error: countError } = await admin
    .from('scam_reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', userId)
    .gte('created_at', since);
  if (countError) return fail('persistence-error', SAVE_FAILED);
  if ((count ?? 0) >= SCAM_REPORT_LIMITS.reportsPerWindow) {
    return fail(
      'rate-limited',
      `You can file up to ${SCAM_REPORT_LIMITS.reportsPerWindow} reports every ${SCAM_REPORT_LIMITS.windowDays} days. Contact us if you need to report more.`,
    );
  }

  const validation = validateScamReport(input, `${userId}/`, new Date());
  if (!validation.ok) return fail('invalid-report', validation.message, validation.field);
  const report = validation.value;

  const secret = scamFingerprintSecret();
  if (!secret) return fail('persistence-error', SAVE_FAILED);

  let evidence: string[];
  try {
    evidence = await existingScamEvidence(admin, userId, report.evidencePaths);
  } catch {
    return fail('persistence-error', SAVE_FAILED);
  }
  if (evidence.length === 0) {
    return fail('invalid-report', 'Your photos didn’t upload. Add them again.', 'evidence');
  }

  const { data: created, error: insertError } = await admin
    .from('scam_reports')
    .insert({
      reporter_id: userId,
      narrative: report.narrative,
      occurred_month: report.occurredMonth,
      amount_minor: report.amountMinor,
      currency: report.currency,
      payment_method: report.paymentMethod,
      scammer_name_text: report.scammerName,
      evidence_paths: evidence,
      declared_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !created) return fail('persistence-error', SAVE_FAILED);

  const rows = report.identifiers.flatMap(expandIdentifier).flatMap((identifier) => {
    const hash = identifierHash(identifier, secret);
    return hash
      ? [{ report_id: created.id, kind: identifier.kind, platform: identifier.platform ?? '', value_hash: hash, hint: maskIdentifier(identifier) }]
      : [];
  });
  const { error: identifierError } = await admin
    .from('scam_report_identifiers')
    .upsert(rows, { onConflict: 'report_id,kind,platform,value_hash', ignoreDuplicates: true });
  if (identifierError) {
    // A report with no fingerprints protects nobody; take it back rather than keep half.
    await admin.from('scam_reports').delete().eq('id', created.id);
    return fail('persistence-error', SAVE_FAILED);
  }

  await findMatchesForReport(created.id, admin);

  revalidatePath('/report-scam');
  revalidatePath('/admin');
  return ok({ id: created.id });
});

/** Withdraw your own report. It stops matching at once and is deleted 90 days later. */
export const withdrawScamReport = withActionLog('scamReports.withdrawScamReport', async function withdrawScamReport(
  reportId: string,
): Promise<ActionResult<{ id: string }, ScamReportError>> {
  const userId = await currentUserId();
  if (!userId) return fail('not-authenticated', 'Sign in to manage your reports.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('scam_reports')
    .update({ status: 'WITHDRAWN', withdrawn_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('reporter_id', userId)
    .not('status', 'in', '(DISMISSED,WITHDRAWN)')
    .select('id')
    .maybeSingle();
  if (error) return fail('persistence-error', 'Could not withdraw the report. Try again.');
  if (!data) return fail('not-found', 'That report can’t be withdrawn.');

  const { error: matchError } = await admin.from('scam_report_matches').delete().eq('report_id', reportId);
  if (matchError) return fail('persistence-error', 'Could not withdraw the report. Try again.');

  revalidatePath('/report-scam');
  revalidatePath('/admin');
  return ok({ id: data.id });
});

/**
 * Respond to a report staff have told you about. Only the matched member, only after
 * they were notified, and only once.
 */
export const respondToScamReportMatch = withActionLog('scamReports.respondToScamReportMatch', async function respondToScamReportMatch(
  reportId: string,
  response: string,
  photoPaths: string[],
): Promise<ActionResult<{ id: string }, ScamReportError>> {
  const userId = await currentUserId();
  if (!userId) return fail('not-authenticated', 'Sign in to respond.');

  const text = typeof response === 'string' ? response.trim() : '';
  if (text.length < 20) {
    return fail('invalid-report', 'Tell us your side in a bit more detail.', 'response');
  }
  if (text.length > SCAM_REPORT_LIMITS.narrativeMax) {
    return fail('invalid-report', 'Keep it under 4,000 characters.', 'response');
  }
  const paths = [...new Set(Array.isArray(photoPaths) ? photoPaths : [])].filter(
    (path): path is string => typeof path === 'string' && path.startsWith(`${userId}/`) && !path.includes('..'),
  );
  if (paths.length > SCAM_REPORT_LIMITS.evidenceMax) {
    return fail('invalid-report', `Add up to ${SCAM_REPORT_LIMITS.evidenceMax} photos.`, 'photos');
  }

  const admin = createAdminClient();
  let photos: string[];
  try {
    photos = await existingScamEvidence(admin, userId, paths);
  } catch {
    return fail('persistence-error', 'Could not send your response. Try again.');
  }

  const { data, error } = await admin
    .from('scam_report_matches')
    .update({
      member_response: text,
      member_response_paths: photos,
      responded_at: new Date().toISOString(),
    })
    .eq('report_id', reportId)
    .eq('profile_id', userId)
    .not('notified_at', 'is', null)
    .is('responded_at', null)
    .select('report_id')
    .maybeSingle();
  if (error) return fail('persistence-error', 'Could not send your response. Try again.');
  if (!data) return fail('not-found', 'There’s nothing waiting for your response.');

  await createNotification({
    userId,
    type: 'SYSTEM',
    title: 'Response received',
    body: 'Thanks. Our team will review your response.',
    link: null,
  });

  revalidatePath(`/report-scam/response/${reportId}`);
  revalidatePath('/admin');
  return ok({ id: data.report_id });
});
