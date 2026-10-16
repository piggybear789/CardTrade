import 'server-only';

// lib/risk/scamQueue.ts
//
// The Scam reports tab's rows (scam-reports spec, Req 5–7): clusters from
// `loadScamClusters`, each report with its full detail, the reporter's standing, and
// the members it matched with their responses. Evidence and response photos are
// signed for this render only.
//
// The fraud-ban guard is evaluated here, with the pure `canFraudBan`, so the console
// can show WHY a ban cannot be proposed yet. That is a display hint: the actions
// re-read the cluster and re-check the guard before anything happens.

import type { createAdminClient } from '@/lib/supabase/admin';
import { loadScamClusters } from '@/lib/risk/scamClusters';
import { signScamEvidenceUrls } from '@/lib/storage/scamReportEvidence';
import {
  canFraudBan,
  isCorroborated,
  type ScamIdentifierKind,
  type ScamMatchStatus,
  type ScamMatchStrength,
  type ScamReportStatus,
} from '@/domain/risk/scamReports';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ScamQueuePhoto {
  path: string;
  url: string | null;
}

export interface ScamQueueMatch {
  profileId: string;
  displayName: string;
  fraudBanned: boolean;
  strength: ScamMatchStrength;
  kinds: ScamIdentifierKind[];
  status: ScamMatchStatus;
  notifiedAt: string | null;
  responseDueAt: string | null;
  respondedAt: string | null;
  response: string | null;
  responsePhotos: ScamQueuePhoto[];
  banProposedAt: string | null;
  banProposedByName: string | null;
  /** Why a ban cannot be proposed yet, or null when it can. */
  banBlockedReason: string | null;
  /** The staff open-sales override, when one is set. 0 means paused. */
  exposureOverrideMinor: number | null;
  /** Their Trusted Seller review status, when they applied. */
  trustedSellerStatus: string | null;
}

export interface ScamQueueReport {
  id: string;
  status: ScamReportStatus;
  createdAt: string;
  occurredMonth: string;
  paymentMethod: string;
  amountMinor: number | null;
  currency: string | null;
  scammerName: string | null;
  narrative: string;
  staffNotes: string | null;
  dismissReason: string | null;
  evidence: ScamQueuePhoto[];
  /** Masked hints only; the values were never stored. */
  identifiers: { kind: ScamIdentifierKind; hint: string }[];
  reporter: {
    id: string;
    displayName: string;
    joinedAt: string | null;
    verified: boolean;
    fraudBanned: boolean;
    /** Reports this member has filed among those loaded. */
    reportCount: number;
    /** Completed cash sales and trades, on either side. */
    completedDeals: number;
    rating: number | null;
    ratingCount: number;
  } | null;
  matches: ScamQueueMatch[];
}

export interface ScamQueueCluster {
  key: string;
  strength: number;
  corroborated: boolean;
  hints: string[];
  newestAt: string;
  reports: ScamQueueReport[];
}

/** How many reports the tab reads before clustering. */
const SCAM_REPORTS_LOADED = 200;

function isClosed(status: ScamReportStatus): boolean {
  return status === 'DISMISSED' || status === 'WITHDRAWN';
}

/**
 * Load the queue. `includeClosed` keeps clusters whose every report was dismissed or
 * withdrawn; by default they drop out, since there is nothing left to decide.
 */
export async function loadScamQueue(
  admin: AdminClient,
  { includeClosed = false }: { includeClosed?: boolean } = {},
): Promise<ScamQueueCluster[]> {
  const clusters = (await loadScamClusters(SCAM_REPORTS_LOADED, admin)).filter(
    (cluster) => includeClosed || cluster.reports.some((report) => !isClosed(report.status)),
  );
  const reportIds = clusters.flatMap((cluster) => cluster.reports.map((report) => report.id));
  if (reportIds.length === 0) return [];

  const [{ data: details, error: detailError }, { data: matches, error: matchError }] = await Promise.all([
    admin
      .from('scam_reports')
      .select(
        'id, narrative, occurred_month, amount_minor, currency, payment_method, scammer_name_text, evidence_paths, staff_notes, dismiss_reason',
      )
      .in('id', reportIds),
    admin
      .from('scam_report_matches')
      .select('*')
      .in('report_id', reportIds),
  ]);
  if (detailError) throw detailError;
  if (matchError) throw matchError;

  const reporterIds = clusters.flatMap((cluster) =>
    cluster.reports.flatMap((report) => (report.reporterId ? [report.reporterId] : [])),
  );
  const profileIds = new Set<string>([
    ...reporterIds,
    ...(matches ?? []).flatMap((match) => [match.profile_id, ...(match.ban_proposed_by ? [match.ban_proposed_by] : [])]),
  ]);
  const { data: profiles, error: profileError } = profileIds.size
    ? await admin
        .from('profiles')
        .select(
          'id, display_name, created_at, identity_check_status, fraud_banned_at, rating, rating_count, exposure_limit_override_minor',
        )
        .in('id', [...profileIds])
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const nameOf = (id: string) => profileById.get(id)?.display_name ?? 'Unknown member';

  // Reporter standing (Req 5.2): completed deals on either side of a cash sale or a
  // trade. Bounded, and only for the reporters on screen.
  const uniqueReporters = [...new Set(reporterIds)];
  const matchedIds = [...new Set((matches ?? []).map((match) => match.profile_id))];
  const none = { data: [] as Record<string, string>[] };
  const [salesAsBuyer, salesAsSeller, tradesAsInitiator, tradesAsCounterpart, trustedReviews] = await Promise.all([
    uniqueReporters.length
      ? admin.from('cash_sales').select('buyer_id').in('buyer_id', uniqueReporters).eq('status', 'COMPLETED').limit(5000)
      : none,
    uniqueReporters.length
      ? admin.from('cash_sales').select('seller_id').in('seller_id', uniqueReporters).eq('status', 'COMPLETED').limit(5000)
      : none,
    uniqueReporters.length
      ? admin.from('trades').select('initiator_id').in('initiator_id', uniqueReporters).eq('state', 'COMPLETED').limit(5000)
      : none,
    uniqueReporters.length
      ? admin.from('trades').select('counterpart_id').in('counterpart_id', uniqueReporters).eq('state', 'COMPLETED').limit(5000)
      : none,
    // The matched member's Trusted Seller application, if any (Req 6.5, 7.2).
    matchedIds.length
      ? admin.from('trusted_seller_reviews').select('profile_id, status').in('profile_id', matchedIds)
      : none,
  ]);
  const completedDeals = new Map<string, number>();
  const tally = (rows: Record<string, unknown>[] | null, column: string) => {
    for (const row of rows ?? []) {
      const id = row[column];
      if (typeof id === 'string') completedDeals.set(id, (completedDeals.get(id) ?? 0) + 1);
    }
  };
  tally(salesAsBuyer.data as Record<string, unknown>[] | null, 'buyer_id');
  tally(salesAsSeller.data as Record<string, unknown>[] | null, 'seller_id');
  tally(tradesAsInitiator.data as Record<string, unknown>[] | null, 'initiator_id');
  tally(tradesAsCounterpart.data as Record<string, unknown>[] | null, 'counterpart_id');
  const trustedStatusOf = new Map(
    ((trustedReviews.data ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.profile_id),
      String(row.status),
    ]),
  );

  const reportCountByReporter = new Map<string, number>();
  for (const id of reporterIds) reportCountByReporter.set(id, (reportCountByReporter.get(id) ?? 0) + 1);

  const detailById = new Map((details ?? []).map((row) => [row.id, row]));
  const matchesByReport = new Map<string, NonNullable<typeof matches>>();
  for (const match of matches ?? []) {
    matchesByReport.set(match.report_id, [...(matchesByReport.get(match.report_id) ?? []), match]);
  }

  const signed = await signScamEvidenceUrls(admin, [
    ...(details ?? []).flatMap((row) => row.evidence_paths ?? []),
    ...(matches ?? []).flatMap((match) => match.member_response_paths ?? []),
  ]);
  const urlByPath = new Map(signed.map((entry) => [entry.path, entry.url]));
  const photos = (paths: string[] | null | undefined): ScamQueuePhoto[] =>
    (paths ?? []).map((path) => ({ path, url: urlByPath.get(path) ?? null }));

  const now = new Date();
  return clusters.map((cluster) => ({
    key: cluster.key,
    strength: cluster.strength,
    corroborated: isCorroborated(cluster.strength),
    hints: cluster.hints,
    newestAt: cluster.newestAt,
    reports: cluster.reports.map((report) => {
      const detail = detailById.get(report.id);
      const reporter = report.reporterId ? profileById.get(report.reporterId) : undefined;
      return {
        id: report.id,
        status: report.status,
        createdAt: report.createdAt,
        occurredMonth: detail?.occurred_month ?? '',
        paymentMethod: detail?.payment_method ?? 'OTHER',
        amountMinor: detail?.amount_minor ?? null,
        currency: detail?.currency ?? null,
        scammerName: detail?.scammer_name_text ?? null,
        narrative: detail?.narrative ?? '',
        staffNotes: detail?.staff_notes ?? null,
        dismissReason: detail?.dismiss_reason ?? null,
        evidence: photos(detail?.evidence_paths),
        identifiers: report.identifiers.map((identifier) => ({ kind: identifier.kind, hint: identifier.hint })),
        reporter:
          report.reporterId
            ? {
                id: report.reporterId,
                displayName: reporter?.display_name ?? 'Unknown member',
                joinedAt: reporter?.created_at ?? null,
                verified: reporter?.identity_check_status === 'VERIFIED',
                fraudBanned: Boolean(reporter?.fraud_banned_at),
                reportCount: reportCountByReporter.get(report.reporterId) ?? 0,
                completedDeals: completedDeals.get(report.reporterId) ?? 0,
                rating: reporter?.rating ?? null,
                ratingCount: reporter?.rating_count ?? 0,
              }
            : null,
        matches: (matchesByReport.get(report.id) ?? []).map((match) => {
          const strength = match.strength as ScamMatchStrength;
          const guard = canFraudBan({
            clusterStrength: cluster.strength,
            matchStrength: strength,
            notifiedAt: match.notified_at,
            respondedAt: match.responded_at,
            responseDueAt: match.response_due_at,
            now,
          });
          return {
            profileId: match.profile_id,
            displayName: nameOf(match.profile_id),
            fraudBanned: Boolean(profileById.get(match.profile_id)?.fraud_banned_at),
            strength,
            kinds: match.kinds as ScamIdentifierKind[],
            status: match.status as ScamMatchStatus,
            notifiedAt: match.notified_at,
            responseDueAt: match.response_due_at,
            respondedAt: match.responded_at,
            response: match.member_response,
            responsePhotos: photos(match.member_response_paths),
            banProposedAt: match.ban_proposed_at,
            banProposedByName: match.ban_proposed_by ? nameOf(match.ban_proposed_by) : null,
            banBlockedReason: guard.ok ? null : guard.reason,
            exposureOverrideMinor: profileById.get(match.profile_id)?.exposure_limit_override_minor ?? null,
            trustedSellerStatus: trustedStatusOf.get(match.profile_id) ?? null,
          };
        }),
      };
    }),
  }));
}

/**
 * Open matches per member, for the Trusted Seller tab's warning line. A dismissed
 * match is deleted, so every row here is still live.
 */
export async function scamMatchCountsFor(admin: AdminClient, profileIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (profileIds.length === 0) return counts;
  const { data, error } = await admin
    .from('scam_report_matches')
    .select('profile_id')
    .in('profile_id', profileIds)
    .limit(5000);
  // Before 0154 is applied the table does not exist; no warning beats a broken tab.
  if (error) return counts;
  for (const row of data ?? []) counts.set(row.profile_id, (counts.get(row.profile_id) ?? 0) + 1);
  return counts;
}
