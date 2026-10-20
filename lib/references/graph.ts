import 'server-only';

// lib/references/graph.ts
//
// Loads a unified, cross-platform reference graph for `/references/[handle]`,
// `/sellers/[id]`, and `/api/references/graph` (walking the graph in place).
//
// SYNTHESIS ACROSS ALL PLATFORMS. A person's reference graph merges every
// deal recorded for their profile and/or matching social handles across
// Instagram, Facebook, Discord, eBay, Whatnot, In-person, and NoDitto Escrow
// (`reviews` from completed cash sales & trades). Positive and negative
// experiences stay distinct — a negative experience never nets off a positive
// reference.
//
// STRUCTURE, NOT POSITIONS. The graph says who is drawn per proof tier, each
// drawn person's own strongest vouchers, and which drawn people have dealt with
// each other. The browser lays it out for the screen it is on
// (`domain/references/orbits.ts`), so a phone gets its own layout, not a
// shrunken desktop one.
//
// Reads run on the service role; only public-safe fields leave this module
// (no person keys, no proof paths, no staff fields).

import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatOccurredMonth,
  isUuid,
  negativeCategoryLabel,
  platformLabel,
  roleLabel,
  roleShortLabel,
} from '@/domain/references/reference';
import { isValidHandle, normalizeHandle } from '@/domain/social/socialLinks';
import {
  orbitKey,
  pickDrawn,
  splitConnections,
  type DrawCandidate,
  type OrbitTier,
  type ProofTier,
} from '@/domain/references/orbits';

export interface PlatformSynthesisItem {
  slug: string;
  label: string;
  shortLabel: string;
  count: number;
}

export interface LinkedSocialHandle {
  platform: string;
  platformLabel: string;
  handle: string;
}

export interface ReferenceGraphCentre {
  kind: 'profile' | 'claim' | 'handle';
  /** profiles.id, social_claims.id, or normalized handle string. */
  id: string;
  profileId: string | null;
  claimId: string | null;
  /** Display handle with leading `@` (e.g. `@piggybear789`). */
  handle: string;
  /** URL-safe slug without `@` for `/references/[handle]`. */
  handleSlug: string;
  name: string;
  firstName: string | null;
  identityVerified: boolean;
  isTrustedSeller: boolean;
  regionCode: string | null;
  avatarPath: string | null;
  memberSince: string | null;
  unclaimed: boolean;
  referenceCount: number;
  peopleCount: number;
  negativeCount: number;
  checkedCount: number;
  platforms: PlatformSynthesisItem[];
  linkedHandles: LinkedSocialHandle[];
}

export interface ReferenceGraphNode {
  id: string;
  profileId: string;
  handle: string;
  handleSlug: string;
  name: string;
  initials: string;
  avatarPath: string | null;
  identityVerified: boolean;
  firstName: string | null;
  /** Their own incoming positive reference count. */
  refs: number;
  platform: string;
  platformLabel: string;
  platformShort: string;
  /** Every platform this referee has dealt with the centre person on. */
  platforms: string[];
  /** How the deal was proven; decides the ring the person is drawn on. */
  kind: ProofTier;
  sentiment: 'POSITIVE' | 'NEGATIVE';
  categoryLabel: string | null;
  comment: string | null;
  role: string;
  roleLabel: string;
  roleShortLabel: string;
  dateLabel: string | null;
  deals: number;
  /** Their own strongest vouchers who are not drawn on the rings. Empty for an issue. */
  children: ReferenceGraphChild[];
}

export interface ReferenceGraphChild {
  profileId: string;
  handle: string;
  handleSlug: string;
  initials: string;
  refs: number;
  /** How their deal with the parent was proven. */
  kind: ProofTier;
}

export interface ReferenceGraphData {
  centre: ReferenceGraphCentre;
  /** The strongest people per proof tier, up to each tier's cap. */
  nodes: ReferenceGraphNode[];
  /** Pairs of drawn people (profile ids) who have dealt with each other. */
  links: [string, string][];
  /** People with references to the centre who are counted but not drawn. */
  hidden: Record<OrbitTier, number>;
}

type Admin = ReturnType<typeof createAdminClient>;

const PLATFORM_SHORT: Record<string, string> = {
  instagram: 'IG',
  facebook: 'FB',
  discord: 'Discord',
  ebay: 'eBay',
  whatnot: 'Whatnot',
  'in-person': 'IRL',
  noditto: 'Escrow',
  other: 'Other',
  x: 'X',
  youtube: 'YT',
  tiktok: 'TikTok',
};

const PROOF_STRENGTH: Record<ProofTier, number> = { escrow: 0, receipt: 1, vouch: 2 };

function initialsOf(name: string): string {
  const parts = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function firstGivenName(full: string | null | undefined): string | null {
  const first = full?.trim().split(/\s+/)[0];
  return first || null;
}

interface RefereeProfile {
  id: string;
  displayName: string;
  firstName: string | null;
  identityVerified: boolean;
  avatarPath: string | null;
}

async function refereeProfiles(admin: Admin, ids: string[]): Promise<Map<string, RefereeProfile>> {
  const map = new Map<string, RefereeProfile>();
  if (ids.length === 0) return map;
  const { data } = await admin
    .from('profiles')
    .select('id, display_name, identity_check_status, identity_check_name, avatar_path')
    .in('id', ids)
    .is('fraud_banned_at', null)
    .is('closed_at', null);
  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      displayName: row.display_name,
      firstName:
        row.identity_check_status === 'VERIFIED' ? firstGivenName(row.identity_check_name) : null,
      identityVerified: row.identity_check_status === 'VERIFIED',
      avatarPath: row.avatar_path,
    });
  }
  return map;
}

/** Handles per profile from claims (first claim in platform order wins). */
async function primaryHandles(
  admin: Admin,
  profileIds: string[],
): Promise<Map<string, { handle: string; handleSlug: string; platform: string }>> {
  const map = new Map<string, { handle: string; handleSlug: string; platform: string }>();
  if (profileIds.length === 0) return map;
  const { data } = await admin
    .from('social_claims')
    .select('platform, handle, claimed_profile_id')
    .in('claimed_profile_id', profileIds);
  for (const row of data ?? []) {
    if (row.claimed_profile_id && !map.has(row.claimed_profile_id)) {
      map.set(row.claimed_profile_id, {
        handle: `@${row.handle}`,
        handleSlug: row.handle,
        platform: row.platform,
      });
    }
  }
  return map;
}

interface MergedEdge {
  voucherId: string;
  sentiment: 'POSITIVE' | 'NEGATIVE';
  categoryLabel: string | null;
  comment: string | null;
  platform: string;
  platforms: string[];
  role: string;
  occurredMonth: string;
  deals: number;
  proofStatus: string;
  hasEscrow: boolean;
}

function proofTierOf(edge: Pick<MergedEdge, 'hasEscrow' | 'proofStatus'>): ProofTier {
  if (edge.hasEscrow) return 'escrow';
  return edge.proofStatus === 'CHECKED' ? 'receipt' : 'vouch';
}

/** Incoming counts (positive people, negative people) per profile id. */
async function incomingCounts(
  admin: Admin,
  profileIds: string[],
): Promise<Map<string, { positive: number; negative: number }>> {
  const counts = new Map<string, { positive: number; negative: number }>();
  if (profileIds.length === 0) return counts;
  const [{ data: edges }, { data: reviews }] = await Promise.all([
    admin
      .from('reference_edges_public')
      .select('voucher_id, target_profile_id, sentiment')
      .in('target_profile_id', profileIds)
      .limit(5000),
    admin
      .from('reviews')
      .select('reviewer_id, reviewee_id')
      .in('reviewee_id', profileIds)
      .limit(5000),
  ]);
  const escrowPairs = new Set<string>();
  for (const review of reviews ?? []) {
    const key = `${review.reviewee_id}:${review.reviewer_id}`;
    if (escrowPairs.has(key)) continue;
    escrowPairs.add(key);
    const entry = counts.get(review.reviewee_id) ?? { positive: 0, negative: 0 };
    entry.positive += 1;
    counts.set(review.reviewee_id, entry);
  }
  const vouchedPairs = new Set<string>();
  for (const edge of edges ?? []) {
    if (!edge.target_profile_id) continue;
    const key = `${edge.target_profile_id}:${edge.voucher_id}:${edge.sentiment}`;
    if (vouchedPairs.has(key)) continue;
    vouchedPairs.add(key);
    const entry = counts.get(edge.target_profile_id) ?? { positive: 0, negative: 0 };
    if (edge.sentiment === 'NEGATIVE') entry.negative += 1;
    else if (!escrowPairs.has(`${edge.target_profile_id}:${edge.voucher_id}`)) entry.positive += 1;
    counts.set(edge.target_profile_id, entry);
  }
  return counts;
}

async function mergedIncoming(
  admin: Admin,
  target: { profileId: string | null; claimIds: string[] },
): Promise<MergedEdge[]> {
  const queries = [];
  if (target.profileId) {
    queries.push(
      admin
        .from('reference_edges_public')
        .select('*')
        .eq('target_profile_id', target.profileId)
        .order('created_at', { ascending: false })
        .limit(500),
    );
  }
  if (target.claimIds.length > 0) {
    queries.push(
      admin
        .from('reference_edges_public')
        .select('*')
        .in('target_claim_id', target.claimIds)
        .order('created_at', { ascending: false })
        .limit(500),
    );
  }
  const reviewsPromise = target.profileId
    ? admin
        .from('reviews')
        .select('reviewer_id, comment, created_at')
        .eq('reviewee_id', target.profileId)
        .order('created_at', { ascending: false })
        .limit(500)
    : Promise.resolve({
        data: [] as { reviewer_id: string; comment: string | null; created_at: string }[],
      });

  const [edgeResults, { data: reviews }] = await Promise.all([
    Promise.all(queries),
    reviewsPromise,
  ]);

  const seenEdgeIds = new Set<string>();
  const allEdges = edgeResults.flatMap((res) => res.data ?? []).filter((edge) => {
    if (seenEdgeIds.has(edge.id)) return false;
    seenEdgeIds.add(edge.id);
    return true;
  });

  const byVoucher = new Map<string, MergedEdge>();
  for (const edge of allEdges) {
    const key = `${edge.voucher_id}:${edge.sentiment}`;
    const existing = byVoucher.get(key);
    if (existing) {
      existing.deals += edge.deal_count;
      if (!existing.platforms.includes(edge.platform)) {
        existing.platforms.push(edge.platform);
      }
      if (!existing.comment && edge.comment) {
        existing.comment = edge.comment;
      }
      continue;
    }
    byVoucher.set(key, {
      voucherId: edge.voucher_id,
      sentiment: edge.sentiment,
      categoryLabel: negativeCategoryLabel(edge.category),
      comment: edge.comment,
      platform: edge.platform,
      platforms: [edge.platform],
      role: edge.role,
      occurredMonth: edge.occurred_month,
      deals: edge.deal_count,
      proofStatus: edge.proof_status,
      hasEscrow: false,
    });
  }
  for (const review of reviews ?? []) {
    const key = `${review.reviewer_id}:POSITIVE`;
    const existing = byVoucher.get(key);
    if (existing) {
      existing.hasEscrow = true;
      existing.deals += 1;
      if (!existing.platforms.includes('noditto')) {
        existing.platforms.push('noditto');
      }
      if (!existing.comment && review.comment) {
        existing.comment = review.comment;
      }
    } else {
      byVoucher.set(key, {
        voucherId: review.reviewer_id,
        sentiment: 'POSITIVE',
        categoryLabel: null,
        comment: review.comment ?? null,
        platform: 'noditto',
        platforms: ['noditto'],
        role: 'BOUGHT',
        occurredMonth: review.created_at.slice(0, 10),
        deals: 1,
        proofStatus: 'NONE',
        hasEscrow: true,
      });
    }
  }
  return Array.from(byVoucher.values());
}

async function assembleGraph(
  admin: Admin,
  centre: Omit<
    ReferenceGraphCentre,
    'referenceCount' | 'peopleCount' | 'negativeCount' | 'checkedCount' | 'platforms'
  >,
  target: { profileId: string | null; claimIds: string[] },
): Promise<ReferenceGraphData> {
  const merged = await mergedIncoming(admin, target);

  const refereeIds = Array.from(new Set(merged.map((e) => e.voucherId)));
  const [profiles, handles, counts] = await Promise.all([
    refereeProfiles(admin, refereeIds),
    primaryHandles(admin, refereeIds),
    incomingCounts(admin, refereeIds),
  ]);

  const validEdges = merged.filter((edge) => profiles.has(edge.voucherId));

  // Synthesise platform breakdown across all valid edges
  const platformTally = new Map<string, number>();
  for (const edge of validEdges) {
    for (const plat of edge.platforms) {
      platformTally.set(plat, (platformTally.get(plat) ?? 0) + 1);
    }
  }
  const platforms: PlatformSynthesisItem[] = Array.from(platformTally.entries())
    .map(([slug, count]) => ({
      slug,
      label: platformLabel(slug),
      shortLabel: PLATFORM_SHORT[slug] ?? platformLabel(slug),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const candidates: (DrawCandidate & { edge: MergedEdge })[] = validEdges.map((edge) => ({
    key: orbitKey(edge.voucherId, edge.sentiment),
    tier: edge.sentiment === 'NEGATIVE' ? 'issue' : proofTierOf(edge),
    standing: counts.get(edge.voucherId)?.positive ?? 0,
    deals: edge.deals,
    edge,
  }));
  const { drawn, hidden } = pickDrawn(candidates);

  // Second degree, for drawn positives only. A voucher who is drawn too becomes
  // an arc between the two; the rest become that person's satellites.
  const drawnIds = drawn.filter((c) => c.tier !== 'issue').map((c) => c.edge.voucherId);
  const secondDegree = drawnIds.length
    ? await mergedIncomingMulti(admin, drawnIds)
    : new Map<string, MergedEdge[]>();
  const secondDegreeIds = Array.from(
    new Set(
      Array.from(secondDegree.values())
        .flat()
        .map((e) => e.voucherId),
    ),
  ).filter((id) => !profiles.has(id));

  if (secondDegreeIds.length > 0) {
    const [extraProfiles, extraHandles, extraCounts] = await Promise.all([
      refereeProfiles(admin, secondDegreeIds),
      primaryHandles(admin, secondDegreeIds),
      incomingCounts(admin, secondDegreeIds),
    ]);
    for (const [k, v] of extraProfiles) profiles.set(k, v);
    for (const [k, v] of extraHandles) handles.set(k, v);
    for (const [k, v] of extraCounts) counts.set(k, v);
  }

  const vouchersOf = new Map<string, string[]>();
  const voucherTier = new Map<string, ProofTier>();
  for (const id of drawnIds) {
    const vouchers = (secondDegree.get(id) ?? [])
      .filter((v) => profiles.has(v.voucherId))
      .sort(
        (a, b) =>
          PROOF_STRENGTH[proofTierOf(a)] - PROOF_STRENGTH[proofTierOf(b)] ||
          (counts.get(b.voucherId)?.positive ?? 0) - (counts.get(a.voucherId)?.positive ?? 0),
      );
    for (const v of vouchers) voucherTier.set(`${id}>${v.voucherId}`, proofTierOf(v));
    vouchersOf.set(id, vouchers.map((v) => v.voucherId));
  }
  const { links, satellites } = splitConnections(drawnIds, vouchersOf, centre.profileId);

  const childOf = (parentId: string, profileId: string): ReferenceGraphChild[] => {
    const profile = profiles.get(profileId);
    if (!profile) return [];
    const handle = handles.get(profileId);
    return [
      {
        profileId,
        handle: handle?.handle ?? `@${profile.displayName}`,
        handleSlug: handle?.handleSlug ?? profile.displayName,
        initials: initialsOf(handle?.handle ?? profile.displayName),
        refs: counts.get(profileId)?.positive ?? 0,
        kind: voucherTier.get(`${parentId}>${profileId}`) ?? 'vouch',
      },
    ];
  };

  const nodes: ReferenceGraphNode[] = drawn.flatMap(({ edge, tier }) => {
    const profile = profiles.get(edge.voucherId);
    if (!profile) return [];
    const handle = handles.get(edge.voucherId);
    return [
      {
        id: `${edge.voucherId}:${edge.sentiment}`,
        profileId: edge.voucherId,
        handle: handle?.handle ?? `@${profile.displayName}`,
        handleSlug: handle?.handleSlug ?? profile.displayName,
        name: profile.displayName,
        initials: initialsOf(handle?.handle ?? profile.displayName),
        avatarPath: profile.avatarPath,
        identityVerified: profile.identityVerified,
        firstName: profile.firstName,
        refs: counts.get(edge.voucherId)?.positive ?? 0,
        platform: edge.platform,
        platformLabel: platformLabel(edge.platform),
        platformShort: PLATFORM_SHORT[edge.platform] ?? platformLabel(edge.platform),
        platforms: edge.platforms,
        kind: proofTierOf(edge),
        sentiment: edge.sentiment,
        categoryLabel: edge.categoryLabel,
        comment: edge.comment,
        role: edge.role,
        roleLabel: roleLabel(edge.role),
        roleShortLabel: roleShortLabel(edge.role),
        dateLabel: formatOccurredMonth(edge.occurredMonth),
        deals: edge.deals,
        children:
          tier === 'issue'
            ? []
            : (satellites.get(edge.voucherId) ?? []).flatMap((id) => childOf(edge.voucherId, id)),
      },
    ];
  });

  const validPositives = validEdges.filter((e) => e.sentiment === 'POSITIVE');
  const totalPositiveDeals = validPositives.reduce((sum, e) => sum + e.deals, 0);

  return {
    centre: {
      ...centre,
      referenceCount: Math.max(validPositives.length, totalPositiveDeals),
      peopleCount: validPositives.length,
      negativeCount: validEdges.length - validPositives.length,
      checkedCount: validPositives.filter((e) => e.proofStatus === 'CHECKED' || e.hasEscrow).length,
      platforms,
    },
    nodes,
    links,
    hidden,
  };
}

/** Batched second-degree reads: incoming positive edges per referee. */
async function mergedIncomingMulti(
  admin: Admin,
  refereeIds: string[],
): Promise<Map<string, MergedEdge[]>> {
  const map = new Map<string, MergedEdge[]>();
  const [{ data: edges }, { data: reviews }] = await Promise.all([
    admin
      .from('reference_edges_public')
      .select('*')
      .in('target_profile_id', refereeIds)
      .eq('sentiment', 'POSITIVE')
      .limit(1000),
    admin
      .from('reviews')
      .select('reviewer_id, reviewee_id, comment, created_at')
      .in('reviewee_id', refereeIds)
      .limit(1000),
  ]);
  // One entry per voucher, keeping the strongest proof any of their deals carries.
  const push = (targetId: string, edge: MergedEdge) => {
    const list = map.get(targetId) ?? [];
    const existing = list.find((e) => e.voucherId === edge.voucherId);
    if (!existing) {
      list.push(edge);
    } else {
      existing.hasEscrow = existing.hasEscrow || edge.hasEscrow;
      if (edge.proofStatus === 'CHECKED') existing.proofStatus = 'CHECKED';
    }
    map.set(targetId, list);
  };
  for (const edge of edges ?? []) {
    if (!edge.target_profile_id) continue;
    push(edge.target_profile_id, {
      voucherId: edge.voucher_id,
      sentiment: 'POSITIVE',
      categoryLabel: null,
      comment: edge.comment,
      platform: edge.platform,
      platforms: [edge.platform],
      role: edge.role,
      occurredMonth: edge.occurred_month,
      deals: edge.deal_count,
      proofStatus: edge.proof_status,
      hasEscrow: false,
    });
  }
  for (const review of reviews ?? []) {
    push(review.reviewee_id, {
      voucherId: review.reviewer_id,
      sentiment: 'POSITIVE',
      categoryLabel: null,
      comment: review.comment ?? null,
      platform: 'noditto',
      platforms: ['noditto'],
      role: 'BOUGHT',
      occurredMonth: review.created_at.slice(0, 10),
      deals: 1,
      proofStatus: 'NONE',
      hasEscrow: true,
    });
  }
  return map;
}

export async function loadProfileReferenceGraph(profileId: string): Promise<ReferenceGraphData | null> {
  const admin = createAdminClient();
  const [{ data: profile }, { data: claims }] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, created_at, trusted_seller_at',
      )
      .eq('id', profileId)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .maybeSingle(),
    admin.from('social_claims').select('id, platform, handle').eq('claimed_profile_id', profileId),
  ]);
  if (!profile) return null;
  const claimRows = claims ?? [];
  const primary = claimRows[0];
  const handleSlug = primary ? primary.handle : profile.display_name;
  const linkedHandles: LinkedSocialHandle[] = claimRows.map((c) => ({
    platform: c.platform,
    platformLabel: platformLabel(c.platform),
    handle: `@${c.handle}`,
  }));

  return assembleGraph(
    admin,
    {
      kind: 'profile',
      id: profile.id,
      profileId: profile.id,
      claimId: primary?.id ?? null,
      handle: primary ? `@${primary.handle}` : `@${profile.display_name}`,
      handleSlug,
      name: profile.display_name,
      firstName:
        profile.identity_check_status === 'VERIFIED'
          ? firstGivenName(profile.identity_check_name)
          : null,
      identityVerified: profile.identity_check_status === 'VERIFIED',
      isTrustedSeller: Boolean(profile.trusted_seller_at),
      regionCode: profile.region_code,
      avatarPath: profile.avatar_path,
      memberSince: profile.created_at,
      unclaimed: false,
      linkedHandles,
    },
    { profileId: profile.id, claimIds: claimRows.map((c) => c.id) },
  );
}

export async function loadClaimReferenceGraph(claimId: string): Promise<ReferenceGraphData | null> {
  const admin = createAdminClient();
  const { data: claim } = await admin
    .from('social_claims')
    .select('id, platform, handle, handle_norm, claimed_profile_id')
    .eq('id', claimId)
    .maybeSingle();
  if (!claim) return null;
  if (claim.claimed_profile_id) {
    return loadProfileReferenceGraph(claim.claimed_profile_id);
  }
  const { data: siblingClaims } = await admin
    .from('social_claims')
    .select('id, platform, handle')
    .eq('handle_norm', claim.handle_norm)
    .is('claimed_profile_id', null);
  const allClaims = siblingClaims?.length ? siblingClaims : [claim];

  return assembleGraph(
    admin,
    {
      kind: 'claim',
      id: claim.id,
      profileId: null,
      claimId: claim.id,
      handle: `@${claim.handle}`,
      handleSlug: claim.handle,
      name: claim.handle,
      firstName: null,
      identityVerified: false,
      isTrustedSeller: false,
      regionCode: null,
      avatarPath: null,
      memberSince: null,
      unclaimed: true,
      linkedHandles: allClaims.map((c) => ({
        platform: c.platform,
        platformLabel: platformLabel(c.platform),
        handle: `@${c.handle}`,
      })),
    },
    { profileId: null, claimIds: allClaims.map((c) => c.id) },
  );
}

/**
 * Load a unified cross-platform reference graph for `/references/[handle]`.
 * Resolves claimed profiles, unclaimed handles across any platform, or even a
 * brand-new valid handle that is about to receive its first reference.
 */
export async function loadHandleReferenceGraph(rawHandle: string): Promise<ReferenceGraphData | null> {
  const decoded = decodeURIComponent(rawHandle ?? '').trim();
  const cleaned = normalizeHandle(decoded);
  if (!cleaned) return null;

  const admin = createAdminClient();

  if (isUuid(cleaned)) {
    const byId = await loadProfileReferenceGraph(cleaned);
    if (byId) return byId;
  }

  const handleNorm = cleaned.toLowerCase();
  const [{ data: matchingClaims }, { data: matchingProfiles }] = await Promise.all([
    admin
      .from('social_claims')
      .select('id, platform, handle, handle_norm, claimed_profile_id')
      .eq('handle_norm', handleNorm),
    admin
      .from('profiles')
      .select('id, display_name')
      .ilike('display_name', cleaned)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .limit(5),
  ]);

  const claims = matchingClaims ?? [];
  const claimedProfileId =
    claims.find((c) => c.claimed_profile_id)?.claimed_profile_id ??
    matchingProfiles?.find((p) => p.display_name.toLowerCase() === handleNorm)?.id ??
    matchingProfiles?.[0]?.id ??
    null;

  if (claimedProfileId) {
    const [{ data: profile }, { data: profileClaims }] = await Promise.all([
      admin
        .from('profiles')
        .select(
          'id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, created_at, trusted_seller_at',
        )
        .eq('id', claimedProfileId)
        .is('fraud_banned_at', null)
        .is('closed_at', null)
        .maybeSingle(),
      admin
        .from('social_claims')
        .select('id, platform, handle')
        .eq('claimed_profile_id', claimedProfileId),
    ]);

    if (profile) {
      const combinedClaims = [...(profileClaims ?? [])];
      for (const c of claims) {
        if (!combinedClaims.some((existing) => existing.id === c.id)) {
          combinedClaims.push(c);
        }
      }
      const primaryHandle =
        claims[0]?.handle ?? combinedClaims[0]?.handle ?? profile.display_name;

      return assembleGraph(
        admin,
        {
          kind: 'profile',
          id: profile.id,
          profileId: profile.id,
          claimId: combinedClaims[0]?.id ?? null,
          handle: `@${primaryHandle}`,
          handleSlug: primaryHandle,
          name: profile.display_name,
          firstName:
            profile.identity_check_status === 'VERIFIED'
              ? firstGivenName(profile.identity_check_name)
              : null,
          identityVerified: profile.identity_check_status === 'VERIFIED',
          isTrustedSeller: Boolean(profile.trusted_seller_at),
          regionCode: profile.region_code,
          avatarPath: profile.avatar_path,
          memberSince: profile.created_at,
          unclaimed: false,
          linkedHandles: combinedClaims.map((c) => ({
            platform: c.platform,
            platformLabel: platformLabel(c.platform),
            handle: `@${c.handle}`,
          })),
        },
        { profileId: profile.id, claimIds: combinedClaims.map((c) => c.id) },
      );
    }
  }

  // Unclaimed handle with 1+ social_claims rows across platforms
  if (claims.length > 0) {
    const primary = claims[0];
    return assembleGraph(
      admin,
      {
        kind: 'claim',
        id: primary.id,
        profileId: null,
        claimId: primary.id,
        handle: `@${primary.handle}`,
        handleSlug: primary.handle,
        name: primary.handle,
        firstName: null,
        identityVerified: false,
        isTrustedSeller: false,
        regionCode: null,
        avatarPath: null,
        memberSince: null,
        unclaimed: true,
        linkedHandles: claims.map((c) => ({
          platform: c.platform,
          platformLabel: platformLabel(c.platform),
          handle: `@${c.handle}`,
        })),
      },
      { profileId: null, claimIds: claims.map((c) => c.id) },
    );
  }

  // Brand-new valid handle: synthesize an empty unclaimed graph so `/references/[handle]`
  // works immediately and lets the viewer share the first experience.
  if (!isValidHandle(cleaned)) return null;

  return {
    centre: {
      kind: 'handle',
      id: cleaned,
      profileId: null,
      claimId: null,
      handle: `@${cleaned}`,
      handleSlug: cleaned,
      name: cleaned,
      firstName: null,
      identityVerified: false,
      isTrustedSeller: false,
      regionCode: null,
      avatarPath: null,
      memberSince: null,
      unclaimed: true,
      referenceCount: 0,
      peopleCount: 0,
      negativeCount: 0,
      checkedCount: 0,
      platforms: [],
      linkedHandles: [],
    },
    nodes: [],
    links: [],
    hidden: { escrow: 0, receipt: 0, vouch: 0, issue: 0 },
  };
}

export { platformLabel };
