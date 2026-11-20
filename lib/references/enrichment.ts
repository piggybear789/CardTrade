import 'server-only';

// lib/references/enrichment.ts
//
// Orchestrates enriched "Is this person real?" background checks (0169):
//   1. Ephemeral payment/handle HMAC check against `scam_report_identifiers` (never persisted,
//      only anonymized corroborated match counts leave this module).
//   2. NoDitto member/claim lookup + `peopleTallies` (verified references stay strictly separate).
//   3. Hybrid pgvector + pg_trgm similarity search (`matchReferenceDossiers`).
//   4. eBay Browse + Trading API lookup (`lookupEbaySeller`).
//   5. Optional async Python OSINT worker (`OSINT_WORKER_URL`) for Sherlock + web scouring,
//      with a fast Reddit JSON public fallback when no Python worker is configured.

import { createHash } from 'node:crypto';

import {
  computeRealnessAssessment,
  type BackgroundCheckDossier,
  type CheckSourcesStatus,
  type CheckStepResult,
  type EbaySellerSummary,
  type FootprintJudgeVerdict,
  type LookalikeClaimView,
  type MarketPriceCompResult,
  type MatchedMemberSummary,
  type PaymentForensicsReport,
  type PsaCertCheckResult,
  type ScamRiskSummary,
  type SherlockMatchView,
  type VectorMatchView,
  type WebMentionView,
} from '@/domain/references/enrichment';
import { analyzePaymentRail } from '@/domain/references/paymentForensics';
import {
  analyzeDmScriptHeuristic,
  buildProfileForensicsReport,
  type DmScamAnalysis,
  type ProfileForensicsReport,
  type VisibleProfileMetrics,
} from '@/domain/references/profileForensics';
import { facebookProfileOfUrl, type FacebookIndexReport } from '@/domain/references/facebookIndex';
import { filterOpenWebMentions } from '@/domain/references/footprintPresentation';
import {
  candidateHandlesFromName,
  inferPaymentIdentifierCandidates,
  parseReferenceLookupInput,
} from '@/domain/references/lookup';
import {
  displayNameLabel,
  isClaimPlatform,
  isUuid,
  isValidClaimHandle,
  type ClaimPlatform,
} from '@/domain/references/reference';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import { expandIdentifier, identifierHash, normaliseIdentifier } from '@/domain/risk/scamReports';
import { normalizeHandle } from '@/domain/social/socialLinks';
import { lookupEbaySeller } from '@/lib/enrichment/ebay';
import { isAiWebScourConfigured, scourOpenWeb, type WebScourHit } from '@/lib/enrichment/aiWebScour';
import { probeFacebookIndex } from '@/lib/enrichment/facebookIndex';
import {
  buildDeterministicJudgeVerdict,
  judgeFootprint,
} from '@/lib/enrichment/footprintJudge';
import { fetchInstagramVisibleProfile, lookupWaybackFirstSeen } from '@/lib/enrichment/instagramProfile';
import { checkLiveMarketPriceComp, checkPsaCert } from '@/lib/enrichment/psaCert';
import { EMPTY_TALLY, peopleTallies, profileKey, claimKey } from '@/lib/references/people';
import { matchReferenceDossiers, upsertDossierEmbedding } from '@/lib/references/vectorSearch';
import { scamFingerprintSecret } from '@/lib/risk/scamMatching';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for completed check runs
const SIGNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StartCheckInput {
  /** Handle, profile UUID, social URL, or full name (e.g. from Facebook Marketplace). */
  query: string;
  platform?: string | null;
  location?: string | null;
  facebookUrl?: string | null;
  secondaryHandle?: string | null;
  paymentDetail?: string | null;
  /** Bank / PayID account holder name shown in Messenger or banking app (ephemeral). */
  payeeName?: string | null;
  /** Optional PSA Cert # from the listing photo to check PSA + eBay stolen-slab collision. */
  psaCertNumber?: string | null;
  /** Optional card description + seller asking price for live eBay market comp check. */
  cardQuery?: string | null;
  askingPrice?: number | null;
  askingCurrency?: 'AUD' | 'USD' | null;
  /** Optional DM/Messenger text pasted or extracted from a screenshot for scam-script analysis. */
  dmText?: string | null;
  /** Optional visible profile metrics extracted from a dropped profile screenshot. */
  visibleProfile?: VisibleProfileMetrics | null;
  forceRefresh?: boolean;
  requestedBy?: string | null;
}

interface ResolvedTarget {
  targetKind: 'PROFILE' | 'CLAIM' | 'HANDLE' | 'PERSON_NAME';
  targetKey: string;
  queryLabel: string;
  platform: ClaimPlatform | null;
  handle: string | null;
  fbNumericId: string | null;
  profileUrl: string | null;
  ebayHandle: string | null;
  queryName: string | null;
  queryLocation: string | null;
  subjectProfileId: string | null;
  subjectClaimId: string | null;
  oauthEbayVerified: boolean;
  candidateHandles: string[];
}

function handleSearchVariants(handle: string | null): string[] {
  if (!handle) return [];
  const lower = handle.trim().toLowerCase();
  const stripped = lower.replace(/[._-]+/g, '');
  if (stripped.length >= 5 && stripped !== lower) {
    return [stripped];
  }
  return [];
}

/**
 * The public address of a Facebook profile from its vanity or numeric id. The lookup
 * pages pass only the bare handle, so without this the profile's own URL was lost before
 * the check ran (no Wayback lookup, no URL in the search prompt).
 */
function facebookProfileUrlFor(handle: string): string {
  const clean = handle.trim().replace(/^@/, '');
  return /^\d{5,30}$/.test(clean)
    ? `https://www.facebook.com/profile.php?id=${clean}`
    : `https://www.facebook.com/${clean}`;
}

/** The profile URL a stored platform + handle points at, when one can be built. */
function profileUrlFor(platform: string | null, handle: string | null): string | null {
  if (!handle) return null;
  if (platform === 'instagram') return `https://www.instagram.com/${handle}/`;
  if (platform === 'facebook') return facebookProfileUrlFor(handle);
  return null;
}

/**
 * Web mentions found by searching a Facebook profile's NAME rather than its link. A
 * "buyer beware Cat Xuan" post may be about any of several Cat Xuans, so a hit that
 * never mentions this profile's vanity is shown at LOW confidence and never as a scam
 * WARNING against this account. Facebook profile pages (this one's and other people's)
 * are dropped here: they are drawn in the Facebook row, not among mentions.
 */
function tieNameMentionsToProfile(hits: WebScourHit[], slug: string): WebScourHit[] {
  const wanted = slug.toLowerCase();
  const out: WebScourHit[] = [];
  for (const hit of hits) {
    // Profile pages, theirs or anyone's, are drawn in the Facebook row.
    if (facebookProfileOfUrl(hit.url)) continue;
    const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
    if (text.includes(wanted)) {
      out.push(hit);
      continue;
    }
    out.push({
      ...hit,
      riskFlag: hit.riskFlag === 'WARNING' ? 'CAUTION' : hit.riskFlag,
      confidence: 'LOW',
    });
  }
  return out;
}

function stableNameKey(name: string, location: string | null): string {
  const normName = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const normLoc = (location ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(`${normName}|${normLoc}`).digest('hex').slice(0, 16);
  return `name:${hash}`;
}

async function resolveTarget(input: StartCheckInput): Promise<ResolvedTarget | null> {
  const admin = createAdminClient();
  const rawQuery = (input.query ?? '').trim();
  const location = input.location?.trim().slice(0, 120) || null;
  const secondaryRaw = input.secondaryHandle?.trim() || null;
  const parsedSecondary = secondaryRaw ? parseReferenceLookupInput(secondaryRaw) : null;

  const fbParsed = input.facebookUrl?.trim()
    ? parseReferenceLookupInput(input.facebookUrl.trim())
    : null;

  if (!rawQuery && !fbParsed && !parsedSecondary) return null;

  // UUID target: direct profile or social_claim id.
  if (isUuid(rawQuery)) {
    const [{ data: profile }, { data: claim }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, display_name')
        .eq('id', rawQuery)
        .is('fraud_banned_at', null)
        .is('closed_at', null)
        .maybeSingle(),
      admin
        .from('social_claims')
        .select('id, platform, handle, claimed_profile_id, claim_method')
        .eq('id', rawQuery)
        .maybeSingle(),
    ]);
    if (profile) {
      const { data: claims } = await admin
        .from('social_claims')
        .select('id, platform, handle, claim_method')
        .eq('claimed_profile_id', profile.id);
      const ebayClaim = (claims ?? []).find((c) => c.platform === 'ebay');
      const primary = claims?.[0];
      return {
        targetKind: 'PROFILE',
        targetKey: `profile:${profile.id}`,
        queryLabel: primary ? `@${primary.handle}` : displayNameLabel(profile.display_name),
        platform: (primary?.platform as ClaimPlatform) ?? null,
        handle: primary?.handle ?? null,
        fbNumericId: primary?.platform === 'facebook' && /^\d{5,30}$/.test(primary.handle) ? primary.handle : null,
        profileUrl: profileUrlFor(primary?.platform ?? null, primary?.handle ?? null),
        ebayHandle: ebayClaim?.handle ?? primary?.handle ?? null,
        queryName: displayNameLabel(profile.display_name),
        queryLocation: location,
        subjectProfileId: profile.id,
        subjectClaimId: null,
        oauthEbayVerified: ebayClaim?.claim_method === 'OAUTH',
        candidateHandles: [],
      };
    }
    if (claim) {
      return {
        targetKind: 'CLAIM',
        targetKey: `claim:${claim.id}`,
        queryLabel: `@${claim.handle}`,
        platform: isClaimPlatform(claim.platform) ? claim.platform : null,
        handle: claim.handle,
        fbNumericId: claim.platform === 'facebook' && /^\d{5,30}$/.test(claim.handle) ? claim.handle : null,
        profileUrl: profileUrlFor(claim.platform, claim.handle),
        ebayHandle: claim.platform === 'ebay' ? claim.handle : null,
        queryName: null,
        queryLocation: location,
        subjectProfileId: claim.claimed_profile_id,
        subjectClaimId: claim.id,
        oauthEbayVerified: claim.platform === 'ebay' && claim.claim_method === 'OAUTH',
        candidateHandles: [],
      };
    }
    return null;
  }

  const parsed = rawQuery ? parseReferenceLookupInput(rawQuery) : fbParsed ?? parsedSecondary;
  if (!parsed) return null;

  const explicitPlatform = isClaimPlatform(input.platform) ? input.platform : null;

  if (parsed.kind === 'handle' || (fbParsed?.kind === 'handle' && fbParsed.isNumericFbId)) {
    const effective =
      parsed.kind === 'handle' ? parsed : (fbParsed as Extract<typeof fbParsed, { kind: 'handle' }>);
    const platform = effective.platform ?? explicitPlatform;
    const handle = effective.handle;
    const handleLower = handle.toLowerCase();

    let claimQuery = admin
      .from('social_claims')
      .select('id, platform, handle, claimed_profile_id, claim_method')
      .eq('handle_norm', handleLower);
    if (platform) claimQuery = claimQuery.eq('platform', platform);
    const { data: claims } = await claimQuery.limit(5);
    const matchedClaim = claims?.[0] ?? null;

    const secondaryHandleStr = parsedSecondary?.kind === 'handle' ? parsedSecondary.handle : null;
    const isNumericFb = Boolean(effective.isNumericFbId || (platform === 'facebook' && /^\d{5,30}$/.test(handle)));
    const fbNumericId = isNumericFb ? handle : fbParsed?.kind === 'handle' && fbParsed.isNumericFbId ? fbParsed.handle : null;
    const sherlockHandle = isNumericFb ? secondaryHandleStr : handle;
    const ebayHandle =
      parsedSecondary?.kind === 'handle' && (parsedSecondary.platform === 'ebay' || !parsedSecondary.platform)
        ? parsedSecondary.handle
        : platform === 'ebay' || !isNumericFb
          ? handle
          : null;
    const profileUrl = effective.sourceUrl ?? profileUrlFor(platform, handle);
    const extractedName = effective.extractedName ?? (parsed.kind === 'name' ? parsed.name : null);

    if (matchedClaim?.claimed_profile_id) {
      const { data: allProfileClaims } = await admin
        .from('social_claims')
        .select('id, platform, handle, claim_method')
        .eq('claimed_profile_id', matchedClaim.claimed_profile_id);
      const ebayClaim = (allProfileClaims ?? []).find((c) => c.platform === 'ebay');
      return {
        targetKind: 'PROFILE',
        targetKey: `profile:${matchedClaim.claimed_profile_id}`,
        queryLabel: `@${matchedClaim.handle}`,
        platform: isClaimPlatform(matchedClaim.platform) ? matchedClaim.platform : platform,
        handle: sherlockHandle,
        fbNumericId,
        profileUrl,
        ebayHandle: ebayClaim?.handle ?? ebayHandle,
        queryName: extractedName,
        queryLocation: location,
        subjectProfileId: matchedClaim.claimed_profile_id,
        subjectClaimId: matchedClaim.id,
        oauthEbayVerified: ebayClaim?.claim_method === 'OAUTH',
        candidateHandles: handleSearchVariants(sherlockHandle),
      };
    }

    if (matchedClaim) {
      return {
        targetKind: 'CLAIM',
        targetKey: `claim:${matchedClaim.id}`,
        queryLabel: `@${matchedClaim.handle}`,
        platform: isClaimPlatform(matchedClaim.platform) ? matchedClaim.platform : platform,
        handle: sherlockHandle,
        fbNumericId,
        profileUrl,
        ebayHandle,
        queryName: extractedName,
        queryLocation: location,
        subjectProfileId: null,
        subjectClaimId: matchedClaim.id,
        oauthEbayVerified: false,
        candidateHandles: handleSearchVariants(sherlockHandle),
      };
    }

    return {
      targetKind: 'HANDLE',
      targetKey: `handle:${platform ?? '*'}:${handleLower}`,
      queryLabel: isNumericFb && extractedName ? `${extractedName} (FB ${handle})` : `@${handle}`,
      platform,
      handle: sherlockHandle,
      fbNumericId,
      profileUrl,
      ebayHandle,
      queryName: extractedName,
      queryLocation: location,
      subjectProfileId: null,
      subjectClaimId: null,
      oauthEbayVerified: false,
      candidateHandles:
        extractedName && !sherlockHandle
          ? candidateHandlesFromName(extractedName)
          : handleSearchVariants(sherlockHandle),
    };
  }

  // Full name (e.g. Facebook Marketplace display name)
  const secondaryHandle = parsedSecondary?.kind === 'handle' ? parsedSecondary.handle : null;
  const secondaryEbay =
    parsedSecondary?.kind === 'handle' && (!parsedSecondary.platform || parsedSecondary.platform === 'ebay')
      ? parsedSecondary.handle
      : fbParsed?.kind === 'handle' && !fbParsed.isNumericFbId
        ? fbParsed.handle
        : null;

  return {
    targetKind: 'PERSON_NAME',
    targetKey: stableNameKey(parsed.name, location),
    queryLabel: parsed.name,
    platform: explicitPlatform ?? (fbParsed ? 'facebook' : null),
    handle: secondaryHandle ?? (fbParsed?.kind === 'handle' && !fbParsed.isNumericFbId ? fbParsed.handle : null),
    fbNumericId: fbParsed?.kind === 'handle' && fbParsed.isNumericFbId ? fbParsed.handle : null,
    profileUrl: fbParsed?.kind === 'handle' ? fbParsed.sourceUrl : null,
    ebayHandle: secondaryEbay,
    queryName: parsed.name,
    queryLocation: location,
    subjectProfileId: null,
    subjectClaimId: null,
    oauthEbayVerified: false,
    candidateHandles: secondaryHandle ? [] : candidateHandlesFromName(parsed.name),
  };
}

/**
 * Checks `scam_report_identifiers` for live reports matching any provided handle or
 * Messenger payment detail. Returns ONLY aggregate counts and matched kinds (never PII,
 * reporter IDs, hints, or narratives).
 */
async function checkScamReportHashes(input: {
  handle: string | null;
  platform: ClaimPlatform | null;
  secondaryHandle: string | null;
  paymentDetail: string | null;
  queryName: string | null;
}): Promise<ScamRiskSummary> {
  const admin = createAdminClient();
  const secret = scamFingerprintSecret();
  const hashes = new Map<string, string>(); // hash -> kind label

  if (secret) {
    const candidates: Array<{ kind: 'HANDLE' | 'PAYID_EMAIL' | 'PAYPAL_EMAIL' | 'PAYID_PHONE' | 'PHONE' | 'BANK_ACCOUNT' | 'CRYPTO_WALLET'; value: string; platform?: string | null }> = [];

    const addHandleCandidates = (h: string | null, p: ClaimPlatform | null) => {
      if (!h) return;
      const platforms: ClaimPlatform[] = p
        ? [p]
        : ['instagram', 'facebook', 'discord', 'ebay', 'whatnot'];
      for (const plat of platforms) {
        candidates.push({ kind: 'HANDLE', value: h, platform: plat });
      }
    };

    addHandleCandidates(input.handle, input.platform);
    addHandleCandidates(input.secondaryHandle, null);

    if (input.paymentDetail) {
      for (const c of inferPaymentIdentifierCandidates(input.paymentDetail)) {
        candidates.push(c);
      }
    }

    for (const raw of candidates) {
      const norm = normaliseIdentifier(raw);
      if (!norm) continue;
      for (const expanded of expandIdentifier(norm)) {
        const hash = identifierHash(expanded, secret);
        if (hash) hashes.set(hash, expanded.kind);
      }
    }
  }

  let matchedReportCount = 0;
  const matchedKinds = new Set<string>();
  const distinctReporters = new Set<string>();

  if (hashes.size > 0) {
    const { data: idRows } = await admin
      .from('scam_report_identifiers')
      .select('report_id, kind, value_hash')
      .in('value_hash', Array.from(hashes.keys()))
      .limit(100);

    const reportIds = Array.from(new Set((idRows ?? []).map((r) => r.report_id)));
    if (reportIds.length > 0) {
      const { data: liveReports } = await admin
        .from('scam_reports')
        .select('id, reporter_id, status')
        .in('id', reportIds)
        .not('status', 'in', '("DISMISSED","WITHDRAWN")');

      const liveSet = new Set((liveReports ?? []).map((r) => r.id));
      for (const r of liveReports ?? []) {
        if (r.reporter_id) distinctReporters.add(r.reporter_id);
      }
      for (const row of idRows ?? []) {
        if (liveSet.has(row.report_id)) matchedKinds.add(row.kind);
      }
      matchedReportCount = liveSet.size;
    }
  }

  let nameMatchCount = 0;
  if (input.queryName && input.queryName.trim().length >= 4) {
    const { count } = await admin
      .from('scam_reports')
      .select('id', { count: 'exact', head: true })
      .ilike('scammer_name_text', input.queryName.trim())
      .not('status', 'in', '("DISMISSED","WITHDRAWN")');
    nameMatchCount = count ?? 0;
  }

  return {
    matchedReportCount,
    corroborated: distinctReporters.size >= 2 || matchedReportCount >= 2,
    matchedKinds: Array.from(matchedKinds),
    nameMatchCount,
  };
}

/** Finds matching NoDitto profiles & claimed handles for a name or handle query. */
async function findMatchedMembers(target: ResolvedTarget): Promise<MatchedMemberSummary[]> {
  const admin = createAdminClient();
  const profileIds = new Set<string>();
  const claimIds = new Set<string>();

  if (target.subjectProfileId) profileIds.add(target.subjectProfileId);
  if (target.subjectClaimId) claimIds.add(target.subjectClaimId);

  if (target.queryName) {
    const clean = target.queryName.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: namedProfiles } = await admin
      .from('profiles')
      .select('id')
      .ilike('display_name', `%${clean}%`)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .limit(5);
    for (const p of namedProfiles ?? []) profileIds.add(p.id);
  }

  if (target.handle) {
    const { data: handleClaims } = await admin
      .from('social_claims')
      .select('id, claimed_profile_id')
      .eq('handle_norm', target.handle.toLowerCase())
      .limit(5);
    for (const c of handleClaims ?? []) {
      if (c.claimed_profile_id) profileIds.add(c.claimed_profile_id);
      else claimIds.add(c.id);
    }
  }

  const pIds = Array.from(profileIds);
  const cIds = Array.from(claimIds);
  if (pIds.length === 0 && cIds.length === 0) return [];

  const [profilesRes, claimsRes, tallies] = await Promise.all([
    pIds.length
      ? admin
          .from('profiles')
          .select('id, display_name, region_code, identity_check_status')
          .in('id', pIds)
          .is('fraud_banned_at', null)
          .is('closed_at', null)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string; region_code: string | null; identity_check_status: string }>, error: null }),
    pIds.length
      ? admin
          .from('social_claims')
          .select('claimed_profile_id, platform, handle')
          .in('claimed_profile_id', pIds)
          .order('claimed_at', { ascending: true })
      : Promise.resolve({ data: [] as Array<{ claimed_profile_id: string | null; platform: string; handle: string }>, error: null }),
    peopleTallies(admin, { profileIds: pIds, claimIds: cIds }),
  ]);

  const primaryByProfile = new Map<string, { platform: string; handle: string }>();
  for (const row of claimsRes.data ?? []) {
    if (row.claimed_profile_id && !primaryByProfile.has(row.claimed_profile_id)) {
      primaryByProfile.set(row.claimed_profile_id, { platform: row.platform, handle: row.handle });
    }
  }

  const out: MatchedMemberSummary[] = [];
  for (const p of profilesRes.data ?? []) {
    const primary = primaryByProfile.get(p.id);
    const tally = tallies.get(profileKey(p.id)) ?? EMPTY_TALLY;
    out.push({
      id: p.id,
      displayName: displayNameLabel(p.display_name),
      handle: primary ? `@${primary.handle}` : null,
      platform: primary?.platform ?? null,
      regionCode: p.region_code,
      identityVerified: satisfiesIdentityGate({
        identityCheckStatus: (p.identity_check_status ?? 'NONE') as IdentityCheckStatus,
      }),
      positiveRefs: tally.positive,
      negativeRefs: tally.negative,
    });
  }

  if (out.length === 0 && cIds.length > 0) {
    const { data: unclaimed } = await admin
      .from('social_claims')
      .select('id, platform, handle')
      .in('id', cIds);
    for (const c of unclaimed ?? []) {
      const tally = tallies.get(claimKey(c.id)) ?? EMPTY_TALLY;
      out.push({
        id: c.id,
        displayName: c.handle,
        handle: `@${c.handle}`,
        platform: c.platform,
        regionCode: null,
        identityVerified: false,
        positiveRefs: tally.positive,
        negativeRefs: tally.negative,
      });
    }
  }

  return out;
}

const SCAM_RE = /\b(scam|scammed|scammer|beware|fraud|stolen|stole|fake|chargeback|ripped\s+off|never\s+(?:arrived|shipped|sent))\b/i;
const TCG_RE = /\b(pok[eé]mon|tcg|psa|cgc|bgs|slab|charizard|pikachu|one\s+piece|yugioh|mtg|lorcana|marketplace|facebook|ebay|card)\b/i;

/** Direct lightweight Reddit JSON fallback when the Python OSINT worker is not configured. */
async function fetchRedditFallbackMentions(
  subject: string,
  location: string | null,
  isPersonName: boolean,
): Promise<Array<{ title: string; snippet: string; url: string; sourceLabel: string; riskFlag: 'NONE' | 'CAUTION' | 'WARNING'; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }>> {
  const clean = subject.trim().replace(/^@/, '');
  if (clean.length < 3) return [];
  const q = isPersonName ? `"${clean}"` : clean;
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&limit=8`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NoDittoTrustLookup/1.0 (+https://noditto.app)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) return [];

  const json = (await res.json().catch(() => null)) as {
    data?: {
      children?: Array<{
        data?: { title?: string; selftext?: string; permalink?: string; subreddit?: string };
      }>;
    };
  } | null;

  const tokens = clean.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const locLower = location?.toLowerCase() ?? '';
  const hits: Array<{ title: string; snippet: string; url: string; sourceLabel: string; riskFlag: 'NONE' | 'CAUTION' | 'WARNING'; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }> = [];

  for (const child of json?.data?.children ?? []) {
    const post = child.data;
    if (!post?.title || !post.permalink) continue;
    const text = `${post.title} ${post.selftext ?? ''}`;
    const lower = text.toLowerCase();
    if (!tokens.every((t) => lower.includes(t))) continue;
    const hasTcg = TCG_RE.test(lower);
    const hasScam = SCAM_RE.test(lower);
    const hasLoc = Boolean(locLower && lower.includes(locLower));
    if (!hasTcg && !hasScam && !hasLoc) continue;

    hits.push({
      title: post.title.slice(0, 220),
      snippet: (post.selftext || post.title).slice(0, 480),
      url: `https://www.reddit.com${post.permalink}`,
      sourceLabel: post.subreddit ? `Reddit r/${post.subreddit}` : 'Reddit',
      riskFlag: hasScam ? 'WARNING' : 'NONE',
      confidence: hasLoc && (hasTcg || hasScam) ? 'HIGH' : hasTcg || hasScam ? 'MEDIUM' : 'LOW',
    });
  }
  return hits.slice(0, 6);
}

/** Find lookalike / potential impersonation handles with established references (0170). */
async function findLookalikeClaims(
  handle: string | null,
  excludeClaimId: string | null,
): Promise<LookalikeClaimView[]> {
  if (!handle || /^\d+$/.test(handle) || handle.length < 3) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('find_lookalike_claims', {
    p_handle: handle.toLowerCase(),
    p_exclude_claim_id: excludeClaimId,
    p_limit: 6,
  });
  if (error || !data) return [];
  return data
    .filter((r) => r.exact_stripped_match || r.similarity_score >= 0.55)
    .map((r) => ({
      claimId: r.claim_id,
      platform: r.platform,
      handle: r.handle,
      claimedProfileId: r.claimed_profile_id,
      similarity: Number(r.similarity_score.toFixed(2)),
      exactStrippedMatch: r.exact_stripped_match,
      positiveRefs: Number(r.positive_refs ?? 0),
    }));
}

/**
 * Triggers or loads a background check dossier for a handle, FB URL, or name + context.
 *
 * `onStep` is told as each part of a fresh check finishes (eBay, Instagram, the open web,
 * the scam database, then the summary), so a caller can show the check filling in. A run
 * reused from the cache reports no steps: nothing was checked again.
 */
export async function startOrLoadBackgroundCheck(
  input: StartCheckInput,
  options: { onStep?: (result: CheckStepResult) => void } = {},
): Promise<BackgroundCheckDossier | null> {
  const target = await resolveTarget(input);
  if (!target) return null;

  // A listener that throws (a reader who has gone away) must not fail the check.
  const report = (result: CheckStepResult) => {
    try {
      options.onStep?.(result);
    } catch {
      // Nobody is listening any more; the check still runs and is stored.
    }
  };
  /** Reports a part the moment it settles, and hands its value on unchanged. */
  const reported = <T,>(work: Promise<T>, describe: (value: T) => CheckStepResult | null): Promise<T> =>
    work.then((value) => {
      const result = describe(value);
      if (result) report(result);
      return value;
    });

  const admin = createAdminClient();
  const secondaryRaw = input.secondaryHandle?.trim() || null;
  const parsedSecondary = secondaryRaw ? parseReferenceLookupInput(secondaryRaw) : null;
  const secondaryHandle = parsedSecondary?.kind === 'handle' ? parsedSecondary.handle : null;
  const paymentDetail = input.paymentDetail?.trim() || null;
  const payeeName = input.payeeName?.trim() || null;
  const psaCertRaw = input.psaCertNumber?.trim() || null;
  const cardQuery = input.cardQuery?.trim() || null;
  const askingPrice =
    typeof input.askingPrice === 'number' && Number.isFinite(input.askingPrice) && input.askingPrice > 0
      ? input.askingPrice
      : null;
  const askingCurrency: 'AUD' | 'USD' = input.askingCurrency === 'USD' ? 'USD' : 'AUD';

  const dmAnalysis: DmScamAnalysis | null = input.dmText?.trim()
    ? analyzeDmScriptHeuristic(input.dmText)
    : null;

  // Ephemeral payment-rail forensics (never stored in DB): catches hijacked FB accounts
  // where PayID/bank name != profile name, disposable emails, unrecognised BSBs, or foreign phones.
  const paymentForensics: PaymentForensicsReport | null =
    paymentDetail || payeeName
      ? analyzePaymentRail({
          paymentDetail,
          payeeName,
          profileName: target.queryName ?? (target.handle ? target.handle.replace(/[._\d]+/g, ' ').trim() : null),
          locationHint: target.queryLocation,
        })
      : null;

  // Ephemeral proactive card checks (PSA cert stolen-slab collision + live eBay price comp)
  const psaCertPromise = psaCertRaw
    ? checkPsaCert(psaCertRaw, { subjectHandle: target.ebayHandle ?? target.handle })
    : Promise.resolve(null);
  const priceCompPromise =
    cardQuery && askingPrice
      ? checkLiveMarketPriceComp({ cardQuery, askingPrice, currency: askingCurrency })
      : Promise.resolve(null);

  // Ephemeral check: scam hashes are computed live when paymentDetail is given, never stored.
  const scamRiskPromise = checkScamReportHashes({
    handle: target.handle,
    platform: target.platform,
    secondaryHandle,
    paymentDetail,
    queryName: target.queryName,
  });

  // Reuse a fresh cached run unless the caller attached profile figures (they change the
  // forensics, which are stored with the run). Evidence brought to this check alone (a DM,
  // payment details, a PSA cert, a price) is judged again on top of the stored footprint
  // below, which costs one ~1.5k-token model call instead of a ~45k-token web search.
  if (!input.forceRefresh && !input.visibleProfile) {
    const { data: cachedRun } = await admin
      .from('identity_check_runs')
      .select('*')
      .eq('target_key', target.targetKey)
      .gt('expires_at', new Date().toISOString())
      .in('status', ['QUEUED', 'RUNNING', 'COMPLETED'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedRun) {
      const [scamRisk, psaCert, priceComp] = await Promise.all([
        scamRiskPromise,
        psaCertPromise,
        priceCompPromise,
      ]);
      return buildDossierFromRun(cachedRun, target, scamRisk, {
        paymentForensicsOverride: paymentForensics,
        psaCertOverride: psaCert,
        priceCompOverride: priceComp,
        ...(dmAnalysis ? { dmAnalysisOverride: dmAnalysis } : {}),
        // The stored verdict never saw this evidence, and its tier is the one shown.
        rejudge: Boolean(paymentForensics || psaCert || priceComp || dmAnalysis),
      });
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  const signalExpiresAt = new Date(now.getTime() + SIGNAL_TTL_MS).toISOString();

  const workerUrl = process.env.OSINT_WORKER_URL?.trim().replace(/\/+$/, '');
  const hasWorker = Boolean(workerUrl);

  const waybackTargetUrl =
    target.profileUrl ??
    (target.handle && (!target.platform || target.platform === 'instagram')
      ? `instagram.com/${target.handle}`
      : null);

  // The Instagram profile is read directly unless the caller already supplied one.
  const instagramHandle =
    !input.visibleProfile && target.handle && (!target.platform || target.platform === 'instagram')
      ? target.handle
      : null;
  const instagramStep = (profile: VisibleProfileMetrics | null): CheckStepResult => ({
    step: 'profile',
    platform: 'instagram',
    state: 'done',
    found: profile !== null,
    count: profile?.followersCount ?? null,
  });
  if (!target.ebayHandle) report({ step: 'ebay', state: 'skipped', found: false, count: null });

  // A Facebook profile is read from what search engines hold about it, never from
  // facebook.com (lib/enrichment/facebookIndex.ts). Its indexed name is then what the
  // open-web scour searches for, because group call-outs name people, not vanity links.
  const facebookSlug =
    target.platform === 'facebook' ? (target.fbNumericId ?? target.handle)?.trim().toLowerCase() || null : null;
  const facebookProfileUrl =
    facebookSlug && target.platform === 'facebook'
      ? (target.profileUrl ?? facebookProfileUrlFor(facebookSlug))
      : null;
  const facebookIndexPromise: Promise<FacebookIndexReport | null> =
    facebookSlug && facebookProfileUrl
      ? reported(
          probeFacebookIndex({ slug: facebookSlug, profileUrl: facebookProfileUrl, nameHint: target.queryName }).catch(
            () => null,
          ),
          (fb): CheckStepResult => ({
            step: 'profile',
            platform: 'facebook',
            state: 'done',
            found: Boolean(fb?.indexed),
            count: fb ? fb.sameNameAccounts.length : null,
          }),
        )
      : Promise.resolve(null);
  /** The name a Facebook profile is searched under, when it has one beyond its link. */
  const facebookSearchName = (fb: FacebookIndexReport | null): string | null =>
    target.queryName ?? fb?.displayName ?? null;

  // Run fast checks concurrently (zero FB scraping) — open-web scour always runs inline
  // so Instagram stats, community vouches, and scam call-outs appear on the first render.
  const [
    scamRisk,
    psaCert,
    priceComp,
    matchedMembers,
    vectorMatches,
    ebaySummary,
    lookalikes,
    fetchedIgProfile,
    waybackFirstSeen,
    inlineWebScour,
    facebookIndex,
  ] = await Promise.all([
    reported(scamRiskPromise, (risk) => ({
      step: 'scam',
      state: 'done',
      found: risk.matchedReportCount > 0,
      count: risk.matchedReportCount,
    })),
    psaCertPromise,
    priceCompPromise,
    findMatchedMembers(target),
    matchReferenceDossiers(
      [target.queryLabel, target.queryLocation, target.handle].filter(Boolean).join(' '),
      6,
    ),
    target.ebayHandle
      ? reported(lookupEbaySeller(target.ebayHandle, { oauthVerified: target.oauthEbayVerified }), (ebay) => ({
          step: 'ebay',
          state: 'done',
          found: ebay.found,
          count: ebay.found ? ebay.feedbackScore : null,
        }))
      : Promise.resolve(null),
    findLookalikeClaims(target.handle, target.subjectClaimId),
    // Reported here only when the profile is found: the web scour below can still turn
    // it up, so "not found" is not known until both are back.
    instagramHandle
      ? reported(fetchInstagramVisibleProfile(instagramHandle), (profile) => (profile ? instagramStep(profile) : null))
      : Promise.resolve(null),
    waybackTargetUrl ? lookupWaybackFirstSeen(waybackTargetUrl) : Promise.resolve(null),
    reported(
      isAiWebScourConfigured()
        ? facebookIndexPromise.then(async (fb) => {
            // A Facebook vanity ("cat.xuan162") is never written in a group post; the
            // person's name is. Search the name, then keep only what ties to this profile.
            const fbName = facebookSlug && !target.queryName ? facebookSearchName(fb) : null;
            const scour = await scourOpenWeb({
              subject: fbName ?? target.queryName ?? target.handle ?? target.queryLabel,
              location: target.queryLocation,
              profileUrl: target.profileUrl,
            });
            return fbName && facebookSlug
              ? { ...scour, mentions: tieNameMentionsToProfile(scour.mentions, facebookSlug) }
              : scour;
          })
        : fetchRedditFallbackMentions(
            target.handle ?? target.queryName ?? target.queryLabel,
            target.queryLocation,
            target.targetKind === 'PERSON_NAME' && !target.handle,
          ).then((mentions) => ({
            resolvedName: null,
            mentions,
            provider: 'none' as const,
            discoveredInstagramProfile: null,
          })),
      (scour) => ({ step: 'web', state: 'done', found: scour.mentions.length > 0, count: scour.mentions.length }),
    ),
    facebookIndexPromise,
  ]);
  const redditFallback = filterOpenWebMentions(inlineWebScour.mentions);

  const visibleProfile =
    input.visibleProfile ?? fetchedIgProfile ?? inlineWebScour.discoveredInstagramProfile ?? null;
  // A Facebook target's profile step was reported by its search-index probe.
  if (!fetchedIgProfile && !facebookSlug) {
    report(
      visibleProfile || instagramHandle
        ? instagramStep(visibleProfile)
        : { step: 'profile', platform: 'instagram', state: 'skipped', found: false, count: null },
    );
  }
  const totalPos = matchedMembers.reduce((sum, m) => sum + m.positiveRefs, 0);
  const forensics = buildProfileForensicsReport({
    handle: target.handle,
    fbNumericId: target.fbNumericId,
    visibleProfile,
    waybackFirstSeen,
    lookalikeHighRefCount: lookalikes.filter((l) => l.positiveRefs >= 3 || Boolean(l.claimedProfileId)).length,
    positiveRefs: totalPos,
    ebayFound: Boolean(ebaySummary?.found),
    facebookIndex,
  });

  const sources: CheckSourcesStatus = {
    scamHash: 'done',
    graphVector: 'done',
    profileForensics: 'done',
    paymentRail: paymentForensics ? 'done' : 'skipped',
    psaCert: psaCert ? 'done' : 'skipped',
    priceComp: priceComp ? 'done' : 'skipped',
    ebay: target.ebayHandle ? 'done' : 'skipped',
    sherlock: hasWorker && (target.handle || target.candidateHandles.length > 0) ? 'pending' : 'skipped',
    webSearch: 'done',
  };

  // Run holistic cheap LLM judge (or clean low-noise fallback when no LLM key is configured)
  const initialAssessment = computeRealnessAssessment({
    targetKind: target.targetKind,
    identityVerified: matchedMembers.some((m) => m.identityVerified),
    positiveRefs: totalPos,
    negativeRefs: matchedMembers.reduce((sum, m) => sum + m.negativeRefs, 0),
    hasLocation: Boolean(target.queryLocation),
    hasSecondaryHandle: Boolean(target.handle && target.targetKind === 'PERSON_NAME'),
    scamRisk,
    forensics,
    paymentForensics,
    psaCert,
    priceComp,
    dmAnalysis,
    ebay: ebaySummary,
    sherlockCount: 0,
    webWarningsCount: redditFallback.filter((m) => m.riskFlag === 'WARNING').length,
  });

  const judge = await judgeFootprint({
    queryLabel: target.queryLabel,
    assessment: initialAssessment,
    scamRisk,
    forensics,
    paymentForensics,
    psaCert,
    priceComp,
    dmAnalysis,
    matchedMembers,
    ebay: ebaySummary,
    lookalikes,
    sherlock: [],
    webMentions: redditFallback.map((hit, idx) => ({
      id: `inline-${idx}`,
      title: hit.title,
      snippet: hit.snippet,
      url: hit.url,
      sourceLabel: hit.sourceLabel,
      riskFlag: hit.riskFlag,
      confidence: hit.confidence,
      observedAt: now.toISOString(),
    })),
  });
  report({ step: 'summary', state: 'done', found: true, count: null });

  const { data: runRow, error: runError } = await admin
    .from('identity_check_runs')
    .insert({
      target_kind: target.targetKind,
      target_key: target.targetKey,
      platform: target.platform,
      handle_norm: target.handle?.toLowerCase() ?? null,
      query_name: target.queryName,
      query_location: target.queryLocation,
      target_profile_id: target.subjectProfileId,
      target_claim_id: target.subjectClaimId,
      status: hasWorker ? 'QUEUED' : 'COMPLETED',
      sources_status: sources as unknown as Json,
      summary: {
        matchedMemberCount: matchedMembers.length,
        ebayFound: Boolean(ebaySummary?.found),
        forensics,
        lookalikes,
        dmAnalysis,
        judge,
      } as unknown as Json,
      requested_by: input.requestedBy ?? null,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (runError || !runRow) {
    throw new Error(`[enrichment] failed to create check run: ${runError?.message ?? 'unknown'}`);
  }

  // Persist fast OSINT signals (eBay + fallback Reddit mentions) and graph/vector records
  const fastSignals: Array<{
    run_id: string;
    target_key: string;
    subject_profile_id: string | null;
    subject_claim_id: string | null;
    source: 'EBAY_API' | 'WEB_SEARCH';
    signal_kind: 'EBAY_SELLER_PROFILE' | 'WEB_MENTION' | 'SCAM_ALERT_MENTION';
    external_platform: string | null;
    external_handle: string | null;
    external_url: string | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    risk_flag: 'NONE' | 'CAUTION' | 'WARNING';
    title: string | null;
    snippet: string | null;
    payload: Json;
    observed_at: string;
    expires_at: string;
  }> = [];

  if (ebaySummary?.found) {
    fastSignals.push({
      run_id: runRow.id,
      target_key: target.targetKey,
      subject_profile_id: target.subjectProfileId,
      subject_claim_id: target.subjectClaimId,
      source: 'EBAY_API',
      signal_kind: 'EBAY_SELLER_PROFILE',
      external_platform: 'ebay',
      external_handle: ebaySummary.username,
      external_url: ebaySummary.profileUrl,
      confidence: ebaySummary.oauthVerified ? 'HIGH' : 'MEDIUM',
      risk_flag: 'NONE',
      title: `eBay seller ${ebaySummary.username}`,
      snippet:
        ebaySummary.feedbackScore !== null
          ? `${ebaySummary.feedbackScore} feedback (${ebaySummary.feedbackPercentage ?? '—'}% positive), ${ebaySummary.activeListingsCount} active listings.`
          : ebaySummary.note,
      payload: ebaySummary as unknown as Json,
      observed_at: now.toISOString(),
      expires_at: signalExpiresAt,
    });

    void upsertDossierEmbedding({
      subjectKey: target.targetKey,
      subjectKind: target.subjectProfileId ? 'PROFILE' : target.subjectClaimId ? 'CLAIM' : 'HANDLE',
      platform: 'ebay',
      handleOrName: ebaySummary.username,
      locationHint: target.queryLocation,
      sourceUrl: ebaySummary.profileUrl,
      contentText: `eBay seller ${ebaySummary.username} feedback ${ebaySummary.feedbackScore ?? ''} (${ebaySummary.feedbackPercentage ?? ''}%) ${ebaySummary.sampleListings.map((l) => l.title).join(' | ')}`,
    });
  }

  for (const hit of redditFallback) {
    fastSignals.push({
      run_id: runRow.id,
      target_key: target.targetKey,
      subject_profile_id: target.subjectProfileId,
      subject_claim_id: target.subjectClaimId,
      source: 'WEB_SEARCH',
      signal_kind: hit.riskFlag === 'WARNING' ? 'SCAM_ALERT_MENTION' : 'WEB_MENTION',
      external_platform: hit.sourceLabel,
      external_handle: target.handle ?? target.queryName,
      external_url: hit.url,
      confidence: hit.confidence,
      risk_flag: hit.riskFlag,
      title: hit.title,
      snippet: hit.snippet,
      payload: { sourceLabel: hit.sourceLabel } as Json,
      observed_at: now.toISOString(),
      expires_at: signalExpiresAt,
    });
  }

  if (fastSignals.length > 0) {
    await admin.from('osint_signals').insert(fastSignals);
  }

  // Index matched member summary into pgvector if not present (only claimed profiles, not self-echoes)
  for (const m of matchedMembers.slice(0, 2)) {
    const isClaimOnly = m.id === target.subjectClaimId && !target.subjectProfileId;
    if (isClaimOnly && m.positiveRefs === 0 && m.negativeRefs === 0) continue;
    void upsertDossierEmbedding({
      subjectKey: isClaimOnly ? `claim:${m.id}` : `profile:${m.id}`,
      subjectKind: isClaimOnly ? 'CLAIM' : 'PROFILE',
      platform: m.platform,
      handleOrName: m.handle ? `${m.handle} (${m.displayName})` : m.displayName,
      locationHint: m.regionCode,
      sourceUrl: null,
      contentText: `${m.displayName} ${m.handle ?? ''} ${m.regionCode ?? ''} positive:${m.positiveRefs} negative:${m.negativeRefs}`,
    });
  }

  // Dispatch async Python OSINT worker if configured
  if (hasWorker && workerUrl) {
    const workerSecret = process.env.OSINT_WORKER_SECRET?.trim() ?? '';
    const accepted = await fetch(`${workerUrl}/jobs/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
      },
      body: JSON.stringify({
        runId: runRow.id,
        targetKind: target.targetKind,
        targetKey: target.targetKey,
        subjectProfileId: target.subjectProfileId,
        subjectClaimId: target.subjectClaimId,
        handle: target.handle,
        candidateHandles: target.candidateHandles,
        queryName: target.queryName,
        queryLocation: target.queryLocation,
      }),
      signal: AbortSignal.timeout(4_000),
    })
      .then((r) => r.ok)
      .catch(() => false);

    if (!accepted) {
      // Degrade gracefully to completed fast check + Reddit fallback if worker isn't running
      const fallbackHits = await fetchRedditFallbackMentions(
        target.handle ?? target.queryName ?? target.queryLabel,
        target.queryLocation,
        target.targetKind === 'PERSON_NAME' && !target.handle,
      );
      if (fallbackHits.length > 0) {
        await admin.from('osint_signals').insert(
          fallbackHits.map((hit) => ({
            run_id: runRow.id,
            target_key: target.targetKey,
            subject_profile_id: target.subjectProfileId,
            subject_claim_id: target.subjectClaimId,
            source: 'WEB_SEARCH' as const,
            signal_kind: (hit.riskFlag === 'WARNING' ? 'SCAM_ALERT_MENTION' : 'WEB_MENTION') as 'SCAM_ALERT_MENTION' | 'WEB_MENTION',
            external_platform: hit.sourceLabel,
            external_handle: target.handle ?? target.queryName,
            external_url: hit.url,
            confidence: hit.confidence,
            risk_flag: hit.riskFlag,
            title: hit.title,
            snippet: hit.snippet,
            payload: { sourceLabel: hit.sourceLabel } as Json,
            observed_at: now.toISOString(),
            expires_at: signalExpiresAt,
          })),
        );
      }
      const degradedSources: CheckSourcesStatus = {
        ...sources,
        sherlock: 'skipped',
        webSearch: 'done',
      };
      await admin
        .from('identity_check_runs')
        .update({
          status: 'COMPLETED',
          sources_status: degradedSources as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runRow.id);
    }
  }

  const { data: latestRun } = await admin
    .from('identity_check_runs')
    .select('*')
    .eq('id', runRow.id)
    .single();

  return buildDossierFromRun(latestRun ?? runRow, target, scamRisk, {
    matchedMembers,
    vectorMatches,
    ebayOverride: ebaySummary,
    forensicsOverride: forensics,
    paymentForensicsOverride: paymentForensics,
    psaCertOverride: psaCert,
    priceCompOverride: priceComp,
    lookalikesOverride: lookalikes,
    dmAnalysisOverride: dmAnalysis,
    judgeOverride: judge,
  });
}

/** Loads an existing check run by ID (for polling). */
export async function loadBackgroundCheckRun(runId: string): Promise<BackgroundCheckDossier | null> {
  if (!isUuid(runId)) return null;
  const admin = createAdminClient();
  const { data: runRow } = await admin
    .from('identity_check_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (!runRow) return null;

  const target: ResolvedTarget = {
    targetKind: runRow.target_kind,
    targetKey: runRow.target_key,
    queryLabel: runRow.query_name ?? (runRow.handle_norm ? `@${runRow.handle_norm}` : runRow.target_key),
    platform: isClaimPlatform(runRow.platform) ? runRow.platform : null,
    handle: runRow.handle_norm,
    fbNumericId:
      runRow.platform === 'facebook' && runRow.handle_norm && /^\d{5,30}$/.test(runRow.handle_norm)
        ? runRow.handle_norm
        : null,
    profileUrl: profileUrlFor(runRow.platform, runRow.handle_norm),
    ebayHandle: runRow.handle_norm,
    queryName: runRow.query_name,
    queryLocation: runRow.query_location,
    subjectProfileId: runRow.target_profile_id,
    subjectClaimId: runRow.target_claim_id,
    oauthEbayVerified: false,
    candidateHandles: handleSearchVariants(runRow.handle_norm),
  };

  const scamRisk = await checkScamReportHashes({
    handle: target.handle,
    platform: target.platform,
    secondaryHandle: null,
    paymentDetail: null,
    queryName: target.queryName,
  });

  return buildDossierFromRun(runRow, target, scamRisk);
}

/** Loads the latest cached dossier for a known profile/claim/handle without starting a new run. */
export async function loadCachedDossierForTarget(input: {
  kind: 'profile' | 'claim' | 'handle';
  idOrSlug: string;
  platform?: ClaimPlatform | null;
}): Promise<BackgroundCheckDossier | null> {
  const admin = createAdminClient();
  const targetKey =
    input.kind === 'profile'
      ? `profile:${input.idOrSlug}`
      : input.kind === 'claim'
        ? `claim:${input.idOrSlug}`
        : `handle:${input.platform ?? '*'}:${normalizeHandle(input.idOrSlug).toLowerCase()}`;

  const { data: runRow } = await admin
    .from('identity_check_runs')
    .select('*')
    .eq('target_key', targetKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!runRow) return null;
  return loadBackgroundCheckRun(runRow.id);
}

async function buildDossierFromRun(
  runRow: {
    id: string;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    target_kind: 'PROFILE' | 'CLAIM' | 'HANDLE' | 'PERSON_NAME';
    target_key: string;
    query_location: string | null;
    sources_status: Json;
    summary: Json;
    created_at: string;
    expires_at: string;
  },
  target: ResolvedTarget,
  scamRisk: ScamRiskSummary,
  preloaded?: {
    matchedMembers?: MatchedMemberSummary[];
    vectorMatches?: VectorMatchView[];
    ebayOverride?: EbaySellerSummary | null;
    forensicsOverride?: ProfileForensicsReport;
    paymentForensicsOverride?: PaymentForensicsReport | null;
    psaCertOverride?: PsaCertCheckResult | null;
    priceCompOverride?: MarketPriceCompResult | null;
    lookalikesOverride?: LookalikeClaimView[];
    dmAnalysisOverride?: DmScamAnalysis | null;
    judgeOverride?: FootprintJudgeVerdict | null;
    /** Judge again instead of reading the stored verdict: this check brought evidence the run never saw. */
    rejudge?: boolean;
  },
): Promise<BackgroundCheckDossier> {
  const admin = createAdminClient();
  const storedSummary = (runRow.summary ?? {}) as {
    forensics?: ProfileForensicsReport;
    lookalikes?: LookalikeClaimView[];
    dmAnalysis?: DmScamAnalysis | null;
    judge?: FootprintJudgeVerdict | null;
  };

  const [signalsRes, matchedMembers, vectorMatches, lookalikes] = await Promise.all([
    admin
      .from('osint_signals')
      .select('*')
      .eq('run_id', runRow.id)
      .order('observed_at', { ascending: false })
      .limit(100),
    preloaded?.matchedMembers
      ? Promise.resolve(preloaded.matchedMembers)
      : findMatchedMembers(target),
    preloaded?.vectorMatches
      ? Promise.resolve(preloaded.vectorMatches)
      : matchReferenceDossiers(
          [target.queryLabel, target.queryLocation, target.handle].filter(Boolean).join(' '),
          6,
        ),
    preloaded?.lookalikesOverride
      ? Promise.resolve(preloaded.lookalikesOverride)
      : Array.isArray(storedSummary.lookalikes)
        ? Promise.resolve(storedSummary.lookalikes)
        : findLookalikeClaims(target.handle, target.subjectClaimId),
  ]);

  const signals = signalsRes.data ?? [];
  let ebay: EbaySellerSummary | null = preloaded?.ebayOverride ?? null;
  const sherlock: SherlockMatchView[] = [];
  const rawWebMentions: WebMentionView[] = [];

  for (const sig of signals) {
    if (sig.source === 'EBAY_API' && sig.signal_kind === 'EBAY_SELLER_PROFILE' && !ebay) {
      ebay = sig.payload as unknown as EbaySellerSummary;
    } else if (sig.source === 'SHERLOCK' && sig.signal_kind === 'SHERLOCK_MATCH' && sig.external_url) {
      const cat = (sig.payload as { category?: string } | null)?.category;
      sherlock.push({
        site: sig.external_platform ?? 'Site',
        category:
          cat === 'marketplace' || cat === 'social' || cat === 'forum' ? cat : 'other',
        url: sig.external_url,
        handle: sig.external_handle ?? target.handle ?? '',
        confidence: sig.confidence,
      });
    } else if (sig.source === 'WEB_SEARCH' && sig.external_url) {
      rawWebMentions.push({
        id: sig.id,
        title: sig.title ?? sig.external_url,
        snippet: sig.snippet ?? '',
        url: sig.external_url,
        sourceLabel: sig.external_platform ?? 'Web',
        riskFlag: sig.risk_flag,
        confidence: sig.confidence,
        observedAt: sig.observed_at,
      });
    }
  }
  const webMentions = filterOpenWebMentions(rawWebMentions);

  const topMember = matchedMembers[0];
  const totalPos = matchedMembers.reduce((sum, m) => sum + m.positiveRefs, 0);
  const totalNeg = matchedMembers.reduce((sum, m) => sum + m.negativeRefs, 0);
  const anyVerified = matchedMembers.some((m) => m.identityVerified);
  const webWarningsCount = webMentions.filter((w) => w.riskFlag === 'WARNING').length;

  const forensics: ProfileForensicsReport =
    preloaded?.forensicsOverride ??
    storedSummary.forensics ??
    buildProfileForensicsReport({
      handle: target.handle,
      fbNumericId: target.fbNumericId,
      visibleProfile: null,
      waybackFirstSeen: null,
      lookalikeHighRefCount: lookalikes.filter((l) => l.positiveRefs >= 3 || Boolean(l.claimedProfileId)).length,
      positiveRefs: totalPos,
      ebayFound: Boolean(ebay?.found),
    });

  const dmAnalysis: DmScamAnalysis | null =
    preloaded?.dmAnalysisOverride !== undefined
      ? preloaded.dmAnalysisOverride
      : (storedSummary.dmAnalysis ?? null);
  const paymentForensics: PaymentForensicsReport | null =
    preloaded?.paymentForensicsOverride ?? null;
  const psaCert: PsaCertCheckResult | null = preloaded?.psaCertOverride ?? null;
  const priceComp: MarketPriceCompResult | null = preloaded?.priceCompOverride ?? null;

  const baseAssessment = computeRealnessAssessment({
    targetKind: runRow.target_kind,
    identityVerified: anyVerified,
    positiveRefs: totalPos,
    negativeRefs: totalNeg,
    hasLocation: Boolean(target.queryLocation),
    hasSecondaryHandle: Boolean(target.handle && target.targetKind === 'PERSON_NAME'),
    scamRisk,
    forensics,
    paymentForensics,
    psaCert,
    priceComp,
    dmAnalysis,
    ebay,
    sherlockCount: sherlock.length,
    webWarningsCount,
  });

  const staleFallback =
    storedSummary.judge?.source === 'fallback' &&
    (rawWebMentions.length !== webMentions.length ||
      (forensics.riskLevel !== 'LOW' && storedSummary.judge.warnings.length === 0));
  const rejudged: FootprintJudgeVerdict | null =
    preloaded?.rejudge && !preloaded.judgeOverride
      ? await judgeFootprint({
          queryLabel: target.queryLabel,
          assessment: baseAssessment,
          scamRisk,
          forensics,
          paymentForensics,
          psaCert,
          priceComp,
          dmAnalysis,
          matchedMembers,
          ebay,
          lookalikes,
          sherlock,
          webMentions,
        })
      : null;
  const judge: FootprintJudgeVerdict =
    preloaded?.judgeOverride ??
    rejudged ??
    (!staleFallback ? storedSummary.judge : null) ??
    buildDeterministicJudgeVerdict({
      assessment: baseAssessment,
      scamRisk,
      forensics,
      paymentForensics,
      psaCert,
      priceComp,
      dmAnalysis,
      matchedMembers,
      ebay,
      lookalikes,
      sherlock,
      webMentions,
    });

  const assessment = {
    ...baseAssessment,
    tier: judge.tier,
  };

  const rawSources = (runRow.sources_status ?? {}) as Partial<CheckSourcesStatus>;
  const sources: CheckSourcesStatus = {
    scamHash: rawSources.scamHash ?? 'done',
    graphVector: rawSources.graphVector ?? 'done',
    profileForensics: rawSources.profileForensics ?? 'done',
    paymentRail: paymentForensics ? 'done' : (rawSources.paymentRail ?? 'skipped'),
    psaCert: psaCert ? 'done' : (rawSources.psaCert ?? 'skipped'),
    priceComp: priceComp ? 'done' : (rawSources.priceComp ?? 'skipped'),
    ebay: rawSources.ebay ?? (ebay ? 'done' : 'skipped'),
    sherlock: rawSources.sherlock ?? (sherlock.length > 0 ? 'done' : 'skipped'),
    webSearch: rawSources.webSearch ?? 'done',
  };

  // Validate handle format if present in response
  if (topMember && !isValidClaimHandle(null, topMember.displayName)) {
    // keep displayName sanitized
  }

  return {
    runId: runRow.id,
    status: runRow.status,
    targetKind: runRow.target_kind,
    targetKey: runRow.target_key,
    queryLabel: target.queryLabel,
    locationHint: runRow.query_location,
    checkedAt: runRow.created_at,
    expiresAt: runRow.expires_at,
    sources,
    assessment,
    scamRisk,
    forensics,
    paymentForensics,
    psaCert,
    priceComp,
    lookalikes,
    dmAnalysis,
    matchedMembers,
    ebay,
    sherlock,
    webMentions,
    judge,
    vectorMatches: vectorMatches.filter(
      (vm) =>
        vm.subjectKey !== target.targetKey &&
        !(target.subjectClaimId && vm.subjectKey === `profile:${target.subjectClaimId}`),
    ),
  };
}
