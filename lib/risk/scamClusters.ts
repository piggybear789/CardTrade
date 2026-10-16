import 'server-only';

// lib/risk/scamClusters.ts
//
// Groups scam reports into clusters by shared fingerprint and computes each cluster's
// strength (scam-reports spec, Req 4). Read by the staff console and by the fraud-ban
// guard. `server-only`: never an endpoint.
//
// Two reports are in one cluster when they share any fingerprint, directly or through
// another report. Strength counts INDEPENDENT reporters (`areRelated` over the same
// risk signals the related-accounts refusal uses), with handle-only links at half.

import { createAdminClient } from '@/lib/supabase/admin';
import { loadSignals } from '@/lib/risk/signals';
import { areRelated, type SignalSet } from '@/domain/risk/relatedAccounts';
import {
  clusterStrength,
  type ScamIdentifierKind,
  type ScamReportStatus,
} from '@/domain/risk/scamReports';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ClusterIdentifier {
  kind: ScamIdentifierKind;
  platform: string;
  valueHash: string;
  hint: string;
}

export interface ClusterReportRow {
  id: string;
  reporterId: string | null;
  status: ScamReportStatus;
  createdAt: string;
  identifiers: ClusterIdentifier[];
}

export interface ScamCluster {
  /** Stable key: the smallest report id in the cluster. */
  key: string;
  reports: ClusterReportRow[];
  /** Distinct hints across the cluster, for the card header. */
  hints: string[];
  strength: number;
  newestAt: string;
}

/** Union-find over report ids, joined by shared value hashes. */
function groupReports(reports: ClusterReportRow[]): ClusterReportRow[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const report of reports) parent.set(report.id, report.id);
  const firstByHash = new Map<string, string>();
  for (const report of reports) {
    for (const identifier of report.identifiers) {
      const first = firstByHash.get(identifier.valueHash);
      if (first) union(first, report.id);
      else firstByHash.set(identifier.valueHash, report.id);
    }
  }
  const groups = new Map<string, ClusterReportRow[]>();
  for (const report of reports) {
    const root = find(report.id);
    groups.set(root, [...(groups.get(root) ?? []), report]);
  }
  return [...groups.values()];
}

/**
 * Build clusters from `reports`. A report's `sharedKinds` are the kinds it shares with
 * another report in its cluster, or all its kinds when it stands alone.
 */
async function toClusters(reports: ClusterReportRow[], client: AdminClient): Promise<ScamCluster[]> {
  const reporters = [...new Set(reports.map((r) => r.reporterId).filter((id): id is string => Boolean(id)))];
  const signals = new Map<string, SignalSet>();
  for (const reporter of reporters) signals.set(reporter, await loadSignals(reporter, client));
  const related = (a: string, b: string) => {
    const left = signals.get(a);
    const right = signals.get(b);
    return Boolean(left && right && areRelated(left, right));
  };

  return groupReports(reports).map((group) => {
    const hashCount = new Map<string, number>();
    for (const report of group) {
      for (const identifier of new Set(report.identifiers.map((i) => i.valueHash))) {
        hashCount.set(identifier, (hashCount.get(identifier) ?? 0) + 1);
      }
    }
    const strength = clusterStrength(
      group.map((report) => {
        const shared = report.identifiers.filter((i) => (hashCount.get(i.valueHash) ?? 0) > 1);
        return {
          reportId: report.id,
          reporterId: report.reporterId,
          status: report.status,
          sharedKinds: (shared.length > 0 || group.length > 1 ? shared : report.identifiers).map((i) => i.kind),
        };
      }),
      related,
    );
    const hints = [...new Set(group.flatMap((report) => report.identifiers.map((i) => i.hint)))];
    const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      key: [...group.map((r) => r.id)].sort()[0],
      reports: sorted,
      hints,
      strength,
      newestAt: sorted[0]?.createdAt ?? '',
    };
  });
}

async function loadReportRows(
  client: AdminClient,
  filter: { ids?: string[]; limit?: number },
): Promise<ClusterReportRow[]> {
  let query = client
    .from('scam_reports')
    .select('id, reporter_id, status, created_at')
    .order('created_at', { ascending: false });
  if (filter.ids) query = query.in('id', filter.ids);
  if (filter.limit) query = query.limit(filter.limit);
  const { data: reports, error } = await query;
  if (error) throw error;
  const ids = (reports ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data: identifiers, error: identifierError } = await client
    .from('scam_report_identifiers')
    .select('report_id, kind, platform, value_hash, hint')
    .in('report_id', ids);
  if (identifierError) throw identifierError;

  const byReport = new Map<string, ClusterIdentifier[]>();
  for (const row of identifiers ?? []) {
    byReport.set(row.report_id, [
      ...(byReport.get(row.report_id) ?? []),
      { kind: row.kind as ScamIdentifierKind, platform: row.platform, valueHash: row.value_hash, hint: row.hint },
    ]);
  }
  return (reports ?? []).map((report) => ({
    id: report.id,
    reporterId: report.reporter_id,
    status: report.status,
    createdAt: report.created_at,
    identifiers: byReport.get(report.id) ?? [],
  }));
}

/** The staff console's clusters: the most recent reports, grouped. */
export async function loadScamClusters(
  limit = 500,
  client: AdminClient = createAdminClient(),
): Promise<ScamCluster[]> {
  const reports = await loadReportRows(client, { limit });
  const clusters = await toClusters(reports, client);
  return clusters.sort((a, b) => b.strength - a.strength || b.newestAt.localeCompare(a.newestAt));
}

/**
 * The strength of the cluster one report belongs to, following shared fingerprints
 * transitively. Used by the fraud-ban guard, so it reads the database directly rather
 * than trusting a number from the page.
 */
export async function clusterStrengthForReport(
  reportId: string,
  client: AdminClient = createAdminClient(),
): Promise<number> {
  const seen = new Set<string>([reportId]);
  let frontier = [reportId];
  // Bounded walk: a real cluster is small, and an unbounded one is a data problem.
  for (let hop = 0; hop < 5 && frontier.length > 0; hop++) {
    const { data: own, error } = await client
      .from('scam_report_identifiers')
      .select('value_hash')
      .in('report_id', frontier);
    if (error) throw error;
    const hashes = [...new Set((own ?? []).map((row) => row.value_hash))];
    if (hashes.length === 0) break;
    const { data: others, error: otherError } = await client
      .from('scam_report_identifiers')
      .select('report_id')
      .in('value_hash', hashes);
    if (otherError) throw otherError;
    frontier = [...new Set((others ?? []).map((row) => row.report_id))].filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  const rows = await loadReportRows(client, { ids: [...seen] });
  const clusters = await toClusters(rows, client);
  return clusters.find((cluster) => cluster.reports.some((report) => report.id === reportId))?.strength ?? 0;
}
