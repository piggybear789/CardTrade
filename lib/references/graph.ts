import 'server-only';

// lib/references/graph.ts
//
// Loads a person's reference graph for `/references/[handle]`, `/sellers/[id]`, and
// `/api/references/graph` (walking the graph in place).
//
// ONE PERSON, EVERY HANDLE THEY HAVE CLAIMED. A member's graph merges the deals recorded
// for their profile with NoDitto escrow reviews (`reviews` from completed cash sales and
// trades); their claimed handles have already handed their references over (the claim
// trigger, 0155/0162). A handle nobody has claimed is its own node, ON ITS PLATFORM:
// @john on Instagram and john on Discord are two people, so nothing here ever merges
// two handles because they are spelled alike, and no display name ever stands in for a
// handle. Positive and negative experiences stay distinct — a negative experience
// never nets off a positive reference.
//
// STRUCTURE, NOT POSITIONS. The graph says who is drawn, each drawn person's own
// best-vouched vouchers, and which drawn people have dealt with each other. The
// browser lays it out for the screen it is on (`domain/references/orbits.ts`), so
// a phone gets its own layout, not a shrunken desktop one.
//
// BOTH DIRECTIONS. `nodes` are the references the person RECEIVED; `given` are the
// ones they LEFT for other people, shaped the same so the page can switch between them.
//
// Reads run on the service role; only public-safe fields leave this module
// (no person keys, no proof paths, no staff fields).

import { createAdminClient } from '@/lib/supabase/admin';
import type { ReferenceAddress } from '@/domain/references/address';
import {
  displayNameLabel,
  formatOccurredMonth,
  isClaimPlatform,
  isUuid,
  isValidClaimHandle,
  negativeCategoryLabel,
  platformLabel,
  roleLabel,
  roleShortLabel,
  type ClaimPlatform,
} from '@/domain/references/reference';
import { normalizeHandle } from '@/domain/social/socialLinks';
import { orbitKey, pickDrawn, splitConnections, type DrawCandidate } from '@/domain/references/orbits';

/** How a deal was evidenced: a NoDitto escrow deal, a staff-checked receipt, or a plain vouch. */
export type ReferenceProof = 'escrow' | 'receipt' | 'vouch';

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
  /** profiles.id, social_claims.id, or the handle itself for a handle nobody has placed. */
  id: string;
  profileId: string | null;
  claimId: string | null;
  /** `@handle` for a handle; the display name for a member with no claimed handle. */
  handle: string;
  /** This page's address. `on` is the handle's platform, when there is one. */
  address: ReferenceAddress;
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
  /** Their page. */
  address: ReferenceAddress;
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
  kind: ReferenceProof;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  /** 1..5 star rating given to the centre person. */
  rating?: number;
  categoryLabel: string | null;
  comment: string | null;
  role: string;
  roleLabel: string;
  roleShortLabel: string;
  dateLabel: string | null;
  deals: number;
  /** Their own best-vouched vouchers who are not drawn themselves. Empty for an issue. */
  children: ReferenceGraphChild[];
}

export interface ReferenceGraphChild {
  profileId: string;
  handle: string;
  address: ReferenceAddress;
  initials: string;
  refs: number;
}

/**
 * References the person in the middle has LEFT for other people, drawn the same way
 * as the ones they received. Each node is the person they reviewed; its sentiment,
 * rating, comment and role are the centre's own words about them. An unclaimed
 * handle they reviewed has `profileId` `claim:<social_claims.id>`. There are no
 * second-degree stars or links here: those describe who vouches for whom, which is
 * the received side's question.
 */
export interface ReferenceGraphGiven {
  nodes: ReferenceGraphNode[];
  platforms: PlatformSynthesisItem[];
  hidden: { people: number; issues: number };
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

export interface ReferenceGraphData {
  centre: ReferenceGraphCentre;
  /** The best-vouched people up to the planet cap, then issues up to theirs. */
  nodes: ReferenceGraphNode[];
  /** Pairs of drawn people (profile ids) who have dealt with each other. */
  links: [string, string][];
  /** People with references to the centre who are counted but not drawn. */
  hidden: { people: number; issues: number };
  /** References the centre has left for others. Absent (or empty) for an unclaimed handle. */
  given?: ReferenceGraphGiven;
}

/** One of the people a bare handle could mean, on the page that asks which. */
export interface ReferenceHandleChoice {
  address: ReferenceAddress;
  platform: ClaimPlatform | null;
  handle: string;
  name: string;
  identityVerified: boolean;
  avatarPath: string | null;
  unclaimed: boolean;
}

/** What a references address shows: one person's graph, or the people a bare handle could mean. */
export type ReferencePage =
  | { kind: 'graph'; graph: ReferenceGraphData }
  | { kind: 'choose'; handle: string; choices: ReferenceHandleChoice[] };

const EMPTY_GIVEN: ReferenceGraphGiven = {
  nodes: [],
  platforms: [],
  hidden: { people: 0, issues: 0 },
  positiveCount: 0,
  neutralCount: 0,
  negativeCount: 0,
};

type Admin = ReturnType<typeof createAdminClient>;

const PLATFORM_SHORT: Record<string, string> = {
  instagram: 'IG',
  facebook: 'FB',
  discord: 'Discord',
  ebay: 'eBay',
  whatnot: 'Whatnot',
  noditto: 'NoDitto',
  other: 'Other',
  x: 'X',
  youtube: 'YT',
  tiktok: 'TikTok',
};

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

/** A claimed or unclaimed handle's own page. */
function claimAddress(claim: { handle: string; platform: string }): ReferenceAddress {
  return { slug: claim.handle, on: isClaimPlatform(claim.platform) ? claim.platform : null };
}

function linkedHandle(claim: { handle: string; platform: string }): LinkedSocialHandle {
  return { platform: claim.platform, platformLabel: platformLabel(claim.platform), handle: `@${claim.handle}` };
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

/** How a member is labelled and linked: a claimed handle, or their display name and id. */
interface PersonLink {
  handle: string;
  address: ReferenceAddress;
}

/** Each profile's first claimed handle: the one they verified first. */
async function primaryHandles(admin: Admin, profileIds: string[]): Promise<Map<string, PersonLink>> {
  const map = new Map<string, PersonLink>();
  if (profileIds.length === 0) return map;
  const { data } = await admin
    .from('social_claims')
    .select('platform, handle, claimed_profile_id')
    .in('claimed_profile_id', profileIds)
    .order('claimed_at', { ascending: true });
  for (const row of data ?? []) {
    if (row.claimed_profile_id && !map.has(row.claimed_profile_id)) {
      map.set(row.claimed_profile_id, { handle: `@${row.handle}`, address: claimAddress(row) });
    }
  }
  return map;
}

/** A member with no claimed handle is shown by display name and linked by id, never as a handle. */
function personLinkFor(profile: RefereeProfile, handles: ReadonlyMap<string, PersonLink>): PersonLink {
  return (
    handles.get(profile.id) ?? {
      handle: displayNameLabel(profile.displayName),
      address: { slug: profile.id, on: null },
    }
  );
}

interface MergedEdge {
  voucherId: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  rating: number;
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

function proofOf(edge: Pick<MergedEdge, 'hasEscrow' | 'proofStatus'>): ReferenceProof {
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
        .select('reviewer_id, rating, comment, created_at')
        .eq('reviewee_id', target.profileId)
        .order('created_at', { ascending: false })
        .limit(500)
    : Promise.resolve({
        data: [] as { reviewer_id: string; rating: number; comment: string | null; created_at: string }[],
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

  return mergeEdgeRows(
    allEdges.map((edge) => ({ party: edge.voucher_id, edge })),
    (reviews ?? []).map((review) => ({ party: review.reviewer_id, review })),
  );
}

/** The columns of `reference_edges_public` the merge reads. */
interface EdgeRow {
  platform: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  rating: number | null;
  category: string | null;
  comment: string | null;
  role: string;
  occurred_month: string;
  deal_count: number;
  proof_status: string;
}

interface ReviewRow {
  rating: number | null;
  comment: string | null;
  created_at: string;
}

/**
 * One entry per (other party, sentiment), folding every platform, deal and comment
 * between them. `party` is whoever is on the OTHER end from the person in the
 * middle: the voucher for incoming references, the person reviewed for outgoing ones.
 * It lands in `MergedEdge.voucherId` either way.
 */
function mergeEdgeRows(
  edges: readonly { party: string; edge: EdgeRow }[],
  reviews: readonly { party: string; review: ReviewRow }[],
): MergedEdge[] {
  const byVoucher = new Map<string, MergedEdge>();
  for (const { party, edge } of edges) {
    const key = `${party}:${edge.sentiment}`;
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
      voucherId: party,
      sentiment: edge.sentiment,
      rating:
        edge.rating ??
        (edge.sentiment === 'NEGATIVE' ? 1 : edge.sentiment === 'NEUTRAL' ? 3 : 5),
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
  for (const { party, review } of reviews) {
    const key = `${party}:POSITIVE`;
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
        voucherId: party,
        sentiment: 'POSITIVE',
        rating: review.rating ?? 5,
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

/** How many references sit on each platform, busiest first. */
function platformBreakdown(edges: readonly MergedEdge[]): PlatformSynthesisItem[] {
  const tally = new Map<string, number>();
  for (const edge of edges) {
    for (const plat of edge.platforms) {
      tally.set(plat, (tally.get(plat) ?? 0) + 1);
    }
  }
  return Array.from(tally.entries())
    .map(([slug, count]) => ({
      slug,
      label: platformLabel(slug),
      shortLabel: PLATFORM_SHORT[slug] ?? platformLabel(slug),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The person on the far end of an outgoing reference, already resolved for display. */
interface GivenParty {
  profileId: string;
  handle: string;
  address: ReferenceAddress;
  name: string;
  avatarPath: string | null;
  identityVerified: boolean;
  firstName: string | null;
  refs: number;
}

/**
 * References `profileId` has left for other people (see `ReferenceGraphGiven`).
 * A reference to an unclaimed handle that has since been claimed is filed under the
 * profile that claimed it, so one person is one planet.
 */
async function loadGiven(admin: Admin, profileId: string): Promise<ReferenceGraphGiven> {
  const [{ data: edges }, { data: reviews }] = await Promise.all([
    admin
      .from('reference_edges_public')
      .select('*')
      .eq('voucher_id', profileId)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('reviews')
      .select('reviewee_id, rating, comment, created_at')
      .eq('reviewer_id', profileId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if ((edges ?? []).length === 0 && (reviews ?? []).length === 0) return EMPTY_GIVEN;

  const claimIds = Array.from(
    new Set((edges ?? []).flatMap((e) => (!e.target_profile_id && e.target_claim_id ? [e.target_claim_id] : []))),
  );
  const { data: claims } = claimIds.length
    ? await admin
        .from('social_claims')
        .select('id, platform, handle, claimed_profile_id')
        .in('id', claimIds)
    : { data: [] as { id: string; platform: string; handle: string; claimed_profile_id: string | null }[] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const partyOf = (edge: { target_profile_id: string | null; target_claim_id: string | null }): string | null => {
    if (edge.target_profile_id) return edge.target_profile_id;
    const claim = edge.target_claim_id ? claimById.get(edge.target_claim_id) : undefined;
    if (!claim) return null;
    return claim.claimed_profile_id ?? `claim:${claim.id}`;
  };

  const merged = mergeEdgeRows(
    (edges ?? []).flatMap((edge) => {
      const party = partyOf(edge);
      return party && party !== profileId ? [{ party, edge }] : [];
    }),
    (reviews ?? [])
      .filter((review) => review.reviewee_id !== profileId)
      .map((review) => ({ party: review.reviewee_id, review })),
  );

  const profileIds = Array.from(
    new Set(merged.map((e) => e.voucherId).filter((id) => !id.startsWith('claim:'))),
  );
  const unclaimedIds = Array.from(
    new Set(merged.map((e) => e.voucherId).filter((id) => id.startsWith('claim:')).map((id) => id.slice(6))),
  );
  const [profiles, handles, counts, claimEdges] = await Promise.all([
    refereeProfiles(admin, profileIds),
    primaryHandles(admin, profileIds),
    incomingCounts(admin, profileIds),
    unclaimedIds.length
      ? admin
          .from('reference_edges_public')
          .select('voucher_id, target_claim_id, sentiment')
          .in('target_claim_id', unclaimedIds)
          .limit(5000)
      : Promise.resolve({ data: [] as { voucher_id: string; target_claim_id: string | null; sentiment: string }[] }),
  ]);

  // An unclaimed handle's standing: how many people left it a positive reference.
  const claimStanding = new Map<string, Set<string>>();
  for (const edge of claimEdges.data ?? []) {
    if (!edge.target_claim_id || edge.sentiment === 'NEGATIVE') continue;
    const vouchers = claimStanding.get(edge.target_claim_id) ?? new Set<string>();
    vouchers.add(edge.voucher_id);
    claimStanding.set(edge.target_claim_id, vouchers);
  }

  const parties = new Map<string, GivenParty>();
  for (const id of profileIds) {
    const profile = profiles.get(id);
    if (!profile) continue;
    const link = personLinkFor(profile, handles);
    parties.set(id, {
      profileId: id,
      handle: link.handle,
      address: link.address,
      name: displayNameLabel(profile.displayName),
      avatarPath: profile.avatarPath,
      identityVerified: profile.identityVerified,
      firstName: profile.firstName,
      refs: counts.get(id)?.positive ?? 0,
    });
  }
  for (const claimId of unclaimedIds) {
    const claim = claimById.get(claimId);
    if (!claim) continue;
    parties.set(`claim:${claimId}`, {
      profileId: `claim:${claimId}`,
      handle: `@${claim.handle}`,
      address: claimAddress(claim),
      name: claim.handle,
      avatarPath: null,
      identityVerified: false,
      firstName: null,
      refs: claimStanding.get(claimId)?.size ?? 0,
    });
  }

  const validEdges = merged.filter((edge) => parties.has(edge.voucherId));
  const { drawn, hidden } = pickDrawn(
    validEdges.map((edge) => ({
      key: orbitKey(edge.voucherId, edge.sentiment),
      issue: edge.sentiment === 'NEGATIVE',
      standing: parties.get(edge.voucherId)?.refs ?? 0,
      deals: edge.deals,
      edge,
    })),
  );

  const nodes: ReferenceGraphNode[] = drawn.flatMap(({ edge }) => {
    const party = parties.get(edge.voucherId);
    if (!party) return [];
    return [
      {
        id: `${party.profileId}:${edge.sentiment}`,
        profileId: party.profileId,
        handle: party.handle,
        address: party.address,
        name: party.name,
        initials: initialsOf(party.name || party.handle),
        avatarPath: party.avatarPath,
        identityVerified: party.identityVerified,
        firstName: party.firstName,
        refs: party.refs,
        platform: edge.platform,
        platformLabel: platformLabel(edge.platform),
        platformShort: PLATFORM_SHORT[edge.platform] ?? platformLabel(edge.platform),
        platforms: edge.platforms,
        kind: proofOf(edge),
        sentiment: edge.sentiment,
        rating: edge.rating,
        categoryLabel: edge.categoryLabel,
        comment: edge.comment,
        role: edge.role,
        roleLabel: roleLabel(edge.role),
        roleShortLabel: roleShortLabel(edge.role),
        dateLabel: formatOccurredMonth(edge.occurredMonth),
        deals: edge.deals,
        children: [],
      },
    ];
  });

  return {
    nodes,
    platforms: platformBreakdown(validEdges),
    hidden,
    positiveCount: validEdges.filter((e) => e.sentiment === 'POSITIVE').length,
    neutralCount: validEdges.filter((e) => e.sentiment === 'NEUTRAL').length,
    negativeCount: validEdges.filter((e) => e.sentiment === 'NEGATIVE').length,
  };
}

async function assembleGraph(
  admin: Admin,
  centre: Omit<
    ReferenceGraphCentre,
    'referenceCount' | 'peopleCount' | 'negativeCount' | 'checkedCount' | 'platforms'
  >,
  target: { profileId: string | null; claimIds: string[] },
): Promise<ReferenceGraphData> {
  // Independent of everything below, so it runs alongside the incoming reads.
  const givenPromise = target.profileId ? loadGiven(admin, target.profileId) : Promise.resolve(EMPTY_GIVEN);
  const merged = await mergedIncoming(admin, target);

  const refereeIds = Array.from(new Set(merged.map((e) => e.voucherId)));
  const [profiles, handles, counts] = await Promise.all([
    refereeProfiles(admin, refereeIds),
    primaryHandles(admin, refereeIds),
    incomingCounts(admin, refereeIds),
  ]);

  const validEdges = merged.filter(
    (edge) => profiles.has(edge.voucherId) && edge.voucherId !== centre.profileId,
  );
  const platforms = platformBreakdown(validEdges);

  const candidates: (DrawCandidate & { edge: MergedEdge })[] = validEdges.map((edge) => ({
    key: orbitKey(edge.voucherId, edge.sentiment),
    issue: edge.sentiment === 'NEGATIVE',
    standing: counts.get(edge.voucherId)?.positive ?? 0,
    deals: edge.deals,
    edge,
  }));
  const { drawn, hidden } = pickDrawn(candidates);

  // Second degree, for drawn positives only. A voucher who is drawn too becomes
  // an arc between the two; the rest become the stars around that person.
  const drawnIds = drawn.filter((c) => !c.issue).map((c) => c.edge.voucherId);
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

  const standingOf = (profileId: string) => counts.get(profileId)?.positive ?? 0;
  const vouchersOf = new Map<string, string[]>();
  for (const id of drawnIds) {
    const vouchers = (secondDegree.get(id) ?? [])
      .map((v) => v.voucherId)
      .filter((voucherId) => profiles.has(voucherId))
      .sort((a, b) => standingOf(b) - standingOf(a));
    vouchersOf.set(id, vouchers);
  }
  const { links, stars } = splitConnections(drawnIds, vouchersOf, centre.profileId);

  const childOf = (profileId: string): ReferenceGraphChild[] => {
    const profile = profiles.get(profileId);
    if (!profile) return [];
    const link = personLinkFor(profile, handles);
    return [
      {
        profileId,
        handle: link.handle,
        address: link.address,
        initials: initialsOf(profile.displayName || link.handle),
        refs: standingOf(profileId),
      },
    ];
  };

  const nodes: ReferenceGraphNode[] = drawn.flatMap(({ edge, issue }) => {
    const profile = profiles.get(edge.voucherId);
    if (!profile) return [];
    const link = personLinkFor(profile, handles);
    return [
      {
        id: `${edge.voucherId}:${edge.sentiment}`,
        profileId: edge.voucherId,
        handle: link.handle,
        address: link.address,
        name: displayNameLabel(profile.displayName),
        initials: initialsOf(profile.displayName || link.handle),
        avatarPath: profile.avatarPath,
        identityVerified: profile.identityVerified,
        firstName: profile.firstName,
        refs: counts.get(edge.voucherId)?.positive ?? 0,
        platform: edge.platform,
        platformLabel: platformLabel(edge.platform),
        platformShort: PLATFORM_SHORT[edge.platform] ?? platformLabel(edge.platform),
        platforms: edge.platforms,
        kind: proofOf(edge),
        sentiment: edge.sentiment,
        rating: edge.rating,
        categoryLabel: edge.categoryLabel,
        comment: edge.comment,
        role: edge.role,
        roleLabel: roleLabel(edge.role),
        roleShortLabel: roleShortLabel(edge.role),
        dateLabel: formatOccurredMonth(edge.occurredMonth),
        deals: edge.deals,
        children: issue ? [] : (stars.get(edge.voucherId) ?? []).flatMap(childOf),
      },
    ];
  });

  const validPositives = validEdges.filter((e) => e.sentiment === 'POSITIVE');
  const validNegatives = validEdges.filter((e) => e.sentiment === 'NEGATIVE');
  const totalPositiveDeals = validPositives.reduce((sum, e) => sum + e.deals, 0);

  return {
    centre: {
      ...centre,
      referenceCount: Math.max(validPositives.length, totalPositiveDeals),
      peopleCount: validPositives.length,
      negativeCount: validNegatives.length,
      checkedCount: validPositives.filter((e) => e.proofStatus === 'CHECKED' || e.hasEscrow).length,
      platforms,
    },
    nodes,
    links,
    hidden,
    given: await givenPromise,
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
      rating: edge.rating ?? 5,
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
      rating: 5,
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
    admin
      .from('social_claims')
      .select('id, platform, handle')
      .eq('claimed_profile_id', profileId)
      .order('claimed_at', { ascending: true }),
  ]);
  if (!profile) return null;
  const claimRows = claims ?? [];
  const primary = claimRows[0];
  const name = displayNameLabel(profile.display_name);

  return assembleGraph(
    admin,
    {
      kind: 'profile',
      id: profile.id,
      profileId: profile.id,
      claimId: primary?.id ?? null,
      handle: primary ? `@${primary.handle}` : name,
      address: primary ? claimAddress(primary) : { slug: profile.id, on: null },
      name,
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
      linkedHandles: claimRows.map(linkedHandle),
    },
    { profileId: profile.id, claimIds: claimRows.map((c) => c.id) },
  );
}

/** One handle's graph: its claimant's when claimed, else the handle alone, on its platform. */
export async function loadClaimReferenceGraph(claimId: string): Promise<ReferenceGraphData | null> {
  const admin = createAdminClient();
  const { data: claim } = await admin
    .from('social_claims')
    .select('id, platform, handle, claimed_profile_id')
    .eq('id', claimId)
    .maybeSingle();
  if (!claim) return null;
  if (claim.claimed_profile_id) {
    return loadProfileReferenceGraph(claim.claimed_profile_id);
  }

  return assembleGraph(
    admin,
    {
      kind: 'claim',
      id: claim.id,
      profileId: null,
      claimId: claim.id,
      handle: `@${claim.handle}`,
      address: claimAddress(claim),
      name: claim.handle,
      firstName: null,
      identityVerified: false,
      isTrustedSeller: false,
      regionCode: null,
      avatarPath: null,
      memberSince: null,
      unclaimed: true,
      linkedHandles: [linkedHandle(claim)],
    },
    { profileId: null, claimIds: [claim.id] },
  );
}

/** A handle with no claim row yet: an empty page that can take its first reference. */
function newHandleGraph(handle: string, on: ClaimPlatform | null): ReferenceGraphData {
  return {
    centre: {
      kind: 'handle',
      id: handle,
      profileId: null,
      claimId: null,
      handle: `@${handle}`,
      address: { slug: handle, on },
      name: handle,
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
    hidden: { people: 0, issues: 0 },
  };
}

function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * What `/references/[slug]?on=<platform>` shows.
 *
 * - A UUID is a profile, or failing that a social claim.
 * - A handle WITH its platform is that one handle: its claimant's graph when claimed,
 *   its own when not, or an empty page for a handle nobody has placed yet.
 * - A handle WITHOUT a platform is resolved only when every claim spelled that way
 *   belongs to one person (or there is exactly one unclaimed handle). Otherwise the
 *   page asks which one is meant, rather than guessing and showing the wrong person.
 *
 * Null for an address that names nobody: not a handle, or a banned or closed member.
 */
export async function loadReferencePage(rawSlug: string, rawOn?: string | null): Promise<ReferencePage | null> {
  const slug = normalizeHandle(decodeSlug(rawSlug ?? ''));
  if (!slug) return null;

  if (isUuid(slug)) {
    const graph = (await loadProfileReferenceGraph(slug)) ?? (await loadClaimReferenceGraph(slug));
    return graph ? { kind: 'graph', graph } : null;
  }

  const on = isClaimPlatform(rawOn) ? rawOn : null;
  if (!isValidClaimHandle(on, slug)) return null;

  const admin = createAdminClient();
  let claimsQuery = admin
    .from('social_claims')
    .select('id, platform, handle, claimed_profile_id')
    .eq('handle_norm', slug.toLowerCase());
  if (on) claimsQuery = claimsQuery.eq('platform', on);
  const { data: claims, error } = await claimsQuery.order('platform', { ascending: true });
  if (error) throw new Error(`[references] load claims for a handle: ${error.message}`);

  const rows = claims ?? [];
  if (rows.length === 0) return { kind: 'graph', graph: newHandleGraph(slug, on) };

  // One person per group: a member's handles on several platforms are one person; each
  // unclaimed handle is its own.
  const groups = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.claimed_profile_id ?? `claim:${row.id}`;
    if (!groups.has(key)) groups.set(key, row);
  }

  const people = await handleChoices(admin, Array.from(groups.values()));
  if (people.length === 0) return null;
  if (people.length > 1) {
    return { kind: 'choose', handle: slug, choices: people.map(({ choice }) => choice) };
  }

  const [{ claim }] = people;
  const graph = claim.claimed_profile_id
    ? await loadProfileReferenceGraph(claim.claimed_profile_id)
    : await loadClaimReferenceGraph(claim.id);
  return graph ? { kind: 'graph', graph } : null;
}

interface ClaimRow {
  id: string;
  platform: string;
  handle: string;
  claimed_profile_id: string | null;
}

/** The people a set of same-spelled claims stand for, without banned or closed members. */
async function handleChoices(
  admin: Admin,
  claims: readonly ClaimRow[],
): Promise<{ claim: ClaimRow; choice: ReferenceHandleChoice }[]> {
  const profileIds = claims.flatMap((claim) => (claim.claimed_profile_id ? [claim.claimed_profile_id] : []));
  const profiles = await refereeProfiles(admin, profileIds);
  return claims.flatMap((claim): { claim: ClaimRow; choice: ReferenceHandleChoice }[] => {
    const address = claimAddress(claim);
    const base = { address, platform: address.on, handle: `@${claim.handle}` };
    if (!claim.claimed_profile_id) {
      return [
        {
          claim,
          choice: { ...base, name: claim.handle, identityVerified: false, avatarPath: null, unclaimed: true },
        },
      ];
    }
    const profile = profiles.get(claim.claimed_profile_id);
    if (!profile) return [];
    return [
      {
        claim,
        choice: {
          ...base,
          name: displayNameLabel(profile.displayName),
          identityVerified: profile.identityVerified,
          avatarPath: profile.avatarPath,
          unclaimed: false,
        },
      },
    ];
  });
}
