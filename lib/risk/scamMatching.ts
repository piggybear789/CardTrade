import 'server-only';

// lib/risk/scamMatching.ts
//
// The service-role store behind scam-report matching (scam-reports spec, Req 6).
//
// `server-only`, NOT a Server Action: "does this member match a scam report" must
// never be an endpoint anyone can call.
//
// WHAT A MEMBER CONTRIBUTES. Only identifiers NoDitto itself holds, fingerprinted the
// same way a report's are (`identifierHash`):
//   * `contact_email`, as both a PayID email and a PayPal email
//   * every handle in `social_links`
//   * the payout account's BSB plus last 4, when the provider exposes it
// Phone numbers and full bank accounts are never matched: NoDitto does not hold them.
//
// NEVER THROWS INTO THE CALLER. Matching is a fraud brake layered on top of everything
// else; a failure is logged (`risk.scam_match`) and the member's action goes ahead.

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { parseSocialLinks } from '@/domain/social/socialLinks';
import {
  identifierHash,
  matchStrength,
  normaliseIdentifier,
  type NormalisedIdentifier,
  type ScamIdentifierKind,
} from '@/domain/risk/scamReports';

type AdminClient = ReturnType<typeof createAdminClient>;
type MatchKeySource = 'CONTACT_EMAIL' | 'SOCIAL_LINK' | 'PAYOUT_ACCOUNT';

/** The same secret the risk signals and person keys use. Empty disables matching. */
export function scamFingerprintSecret(): string {
  return process.env.IDENTITY_FINGERPRINT_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '';
}

interface DerivedKey {
  kind: ScamIdentifierKind;
  platform: string;
  value_hash: string;
  source: MatchKeySource;
}

function hashAll(
  identifiers: (NormalisedIdentifier | null)[],
  source: MatchKeySource,
  secret: string,
): DerivedKey[] {
  const keys: DerivedKey[] = [];
  for (const identifier of identifiers) {
    if (!identifier) continue;
    const hash = identifierHash(identifier, secret);
    if (hash) keys.push({ kind: identifier.kind, platform: identifier.platform ?? '', value_hash: hash, source });
  }
  return keys;
}

/**
 * Re-derive one member's match keys, then look for matches.
 *
 * `payoutBankHint`: pass the provider's BSB and last 4 to replace the payout key,
 * `null` to clear it, or leave it out to keep whatever is stored (the caller did not
 * read the payout account this time).
 */
export async function refreshMemberMatchKeys(
  profileId: string,
  opts: { payoutBankHint?: { routing: string; last4: string } | null } = {},
  client: AdminClient = createAdminClient(),
): Promise<void> {
  try {
    const secret = scamFingerprintSecret();
    if (!secret) return;

    const { data: profile, error } = await client
      .from('profiles')
      .select('contact_email, social_links, closed_at')
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return;

    const email = (profile.contact_email as string | null) ?? '';
    const keys: DerivedKey[] = [
      ...hashAll(
        [
          normaliseIdentifier({ kind: 'PAYID_EMAIL', value: email }),
          normaliseIdentifier({ kind: 'PAYPAL_EMAIL', value: email }),
        ],
        'CONTACT_EMAIL',
        secret,
      ),
      ...hashAll(
        parseSocialLinks((profile.social_links as Record<string, string> | null) ?? null)
          .filter((link) => link.kind === 'handle')
          .map((link) => normaliseIdentifier({ kind: 'HANDLE', value: link.handle, platform: link.slug })),
        'SOCIAL_LINK',
        secret,
      ),
    ];

    const replaceSources: MatchKeySource[] = ['CONTACT_EMAIL', 'SOCIAL_LINK'];
    if (opts.payoutBankHint !== undefined) {
      replaceSources.push('PAYOUT_ACCOUNT');
      const hint = opts.payoutBankHint;
      if (hint && /^\d{6}$/.test(hint.routing.replace(/\D/g, '')) && /^\d{4}$/.test(hint.last4)) {
        keys.push(
          ...hashAll(
            [normaliseIdentifier({ kind: 'BANK_PARTIAL', value: `${hint.routing}${hint.last4}` })],
            'PAYOUT_ACCOUNT',
            secret,
          ),
        );
      }
    }

    const { error: deleteError } = await client
      .from('member_match_keys')
      .delete()
      .eq('profile_id', profileId)
      .in('source', replaceSources);
    if (deleteError) throw deleteError;

    if (keys.length > 0 && !profile.closed_at) {
      const { error: insertError } = await client
        .from('member_match_keys')
        .upsert(
          keys.map((key) => ({ profile_id: profileId, ...key })),
          { onConflict: 'profile_id,kind,platform,value_hash', ignoreDuplicates: true },
        );
      if (insertError) throw insertError;
    }

    const { error: stampError } = await client
      .from('profiles')
      .update({ match_keys_refreshed_at: new Date().toISOString() })
      .eq('id', profileId);
    if (stampError) throw stampError;

    await findMatchesForMember(profileId, client);
  } catch (error) {
    await logBackgroundFailure({
      name: 'risk.scam_match',
      errorCode: 'REFRESH_FAILED',
      error,
      context: { profileId },
    });
  }
}

/** Live report ids among `reportIds` (not dismissed or withdrawn), with their reporter. */
async function liveReports(
  reportIds: string[],
  client: AdminClient,
): Promise<Map<string, string | null>> {
  if (reportIds.length === 0) return new Map();
  const { data, error } = await client
    .from('scam_reports')
    .select('id, reporter_id, status')
    .in('id', reportIds)
    .not('status', 'in', '(DISMISSED,WITHDRAWN)');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row.reporter_id]));
}

/** Write or widen one match. An existing match keeps its staff state. */
async function upsertMatch(
  reportId: string,
  profileId: string,
  kinds: ScamIdentifierKind[],
  client: AdminClient,
): Promise<void> {
  const { data: existing, error: readError } = await client
    .from('scam_report_matches')
    .select('kinds')
    .eq('report_id', reportId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (readError) throw readError;

  const merged = [...new Set([...(existing?.kinds ?? []), ...kinds])] as ScamIdentifierKind[];
  const row = { kinds: merged, strength: matchStrength(merged) };
  const { error } = existing
    ? await client.from('scam_report_matches').update(row).eq('report_id', reportId).eq('profile_id', profileId)
    : await client.from('scam_report_matches').insert({ report_id: reportId, profile_id: profileId, ...row });
  if (error) throw error;
}

/** Match one member's keys against every live report. Never matches a reporter to their own report. */
export async function findMatchesForMember(
  profileId: string,
  client: AdminClient = createAdminClient(),
): Promise<number> {
  try {
    const { data: keys, error } = await client
      .from('member_match_keys')
      .select('kind, platform, value_hash')
      .eq('profile_id', profileId);
    if (error) throw error;
    if (!keys || keys.length === 0) return 0;

    const { data: hits, error: hitError } = await client
      .from('scam_report_identifiers')
      .select('report_id, kind, platform, value_hash')
      .in('value_hash', keys.map((key) => key.value_hash));
    if (hitError) throw hitError;

    const own = new Set(keys.map((key) => `${key.kind}|${key.platform}|${key.value_hash}`));
    const byReport = new Map<string, Set<ScamIdentifierKind>>();
    for (const hit of hits ?? []) {
      if (!own.has(`${hit.kind}|${hit.platform}|${hit.value_hash}`)) continue;
      const kinds = byReport.get(hit.report_id) ?? new Set<ScamIdentifierKind>();
      kinds.add(hit.kind as ScamIdentifierKind);
      byReport.set(hit.report_id, kinds);
    }

    const live = await liveReports([...byReport.keys()], client);
    let matched = 0;
    for (const [reportId, kinds] of byReport) {
      if (!live.has(reportId) || live.get(reportId) === profileId) continue;
      await upsertMatch(reportId, profileId, [...kinds], client);
      matched += 1;
    }
    return matched;
  } catch (error) {
    await logBackgroundFailure({ name: 'risk.scam_match', errorCode: 'MATCH_FAILED', error, context: { profileId } });
    return 0;
  }
}

/** Match one report's fingerprints against every member's keys. */
export async function findMatchesForReport(
  reportId: string,
  client: AdminClient = createAdminClient(),
): Promise<number> {
  try {
    const { data: identifiers, error } = await client
      .from('scam_report_identifiers')
      .select('kind, platform, value_hash')
      .eq('report_id', reportId);
    if (error) throw error;
    if (!identifiers || identifiers.length === 0) return 0;

    const live = await liveReports([reportId], client);
    if (!live.has(reportId)) return 0;
    const reporterId = live.get(reportId) ?? null;

    const { data: keys, error: keyError } = await client
      .from('member_match_keys')
      .select('profile_id, kind, platform, value_hash')
      .in('value_hash', identifiers.map((identifier) => identifier.value_hash));
    if (keyError) throw keyError;

    const wanted = new Set(identifiers.map((i) => `${i.kind}|${i.platform}|${i.value_hash}`));
    const byMember = new Map<string, Set<ScamIdentifierKind>>();
    for (const key of keys ?? []) {
      if (key.profile_id === reporterId) continue;
      if (!wanted.has(`${key.kind}|${key.platform}|${key.value_hash}`)) continue;
      const kinds = byMember.get(key.profile_id) ?? new Set<ScamIdentifierKind>();
      kinds.add(key.kind as ScamIdentifierKind);
      byMember.set(key.profile_id, kinds);
    }

    for (const [profileId, kinds] of byMember) {
      await upsertMatch(reportId, profileId, [...kinds], client);
    }
    return byMember.size;
  } catch (error) {
    await logBackgroundFailure({ name: 'risk.scam_match', errorCode: 'MATCH_FAILED', error, context: { reportId } });
    return 0;
  }
}

/**
 * The `:17` pass: derive keys for members who have none yet (new sign-ups, and every
 * member who existed before 0154). Bounded per run; the rest are picked up next hour.
 */
export async function backfillMemberMatchKeys(
  limit = 200,
  client: AdminClient = createAdminClient(),
): Promise<{ refreshed: number }> {
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .is('match_keys_refreshed_at', null)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  for (const row of data ?? []) {
    await refreshMemberMatchKeys(row.id, {}, client);
  }
  return { refreshed: (data ?? []).length };
}
