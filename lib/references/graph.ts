import 'server-only';

// lib/references/graph.ts
//
// Loads a reference graph for the seller page and unclaimed handle pages.
// Incoming member_references edges are merged with NoDitto escrow reputation
// (completed cash sales / trades, via the public `reviews` they generated):
// a referee who both vouched and dealt in escrow is one node, with the
// escrow kind winning. Positive and negative edges stay separate counts —
// a negative experience never nets off a positive reference.
//
// Reads run on the service role; only public-safe fields leave this module
// (no person keys, no proof paths, no staff fields).

import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatOccurredMonth,
  negativeCategoryLabel,
  platformLabel,
  roleLabel,
} from '@/domain/references/reference';
import { layoutChildren, layoutRing, type PlacedNode } from '@/domain/references/layout';

export const GRAPH_VIEW_WIDTH = 960;
export const GRAPH_VIEW_HEIGHT = 620;
const CENTRE_X = GRAPH_VIEW_WIDTH / 2;
const CENTRE_Y = 300;

export interface ReferenceGraphCentre {
  kind: 'profile' | 'claim';
  /** profiles.id or social_claims.id, matching kind. */
  id: string;
  profileId: string | null;
  handle: string;
  name: string;
  firstName: string | null;
  identityVerified: boolean;
  regionCode: string | null;
  avatarPath: string | null;
  memberSince: string | null;
  unclaimed: boolean;
  referenceCount: number;
  peopleCount: number;
  negativeCount: number;
  checkedCount: number;
}

export interface ReferenceGraphNode {
  id: string;
  profileId: string;
  handle: string;
  name: string;
  initials: string;
  /** Their own incoming positive reference count. Drives size. */
  refs: number;
  platform: string;
  platformShort: string;
  kind: 'receipt' | 'vouch' | 'escrow';
  sentiment: 'POSITIVE' | 'NEGATIVE';
  categoryLabel: string | null;
  comment: string | null;
  role: string;
  roleLabel: string;
  dateLabel: string | null;
  deals: number;
  x: number;
  y: number;
  r: number;
  children: ReferenceGraphChild[];
}

export interface ReferenceGraphChild {
  id: string;
  profileId: string;
  handle: string;
  initials: string;
  refs: number;
  x: number;
  y: number;
  r: number;
  parentId: string;
}

export interface ReferenceGraphData {
  centre: ReferenceGraphCentre;
  nodes: ReferenceGraphNode[];
  width: number;
  height: number;
  centreX: number;
  centreY: number;
}

type Admin = ReturnType<typeof createAdminClient>;

const PLATFORM_SHORT: Record<string, string> = {
  instagram: 'IG',
  facebook: 'FB',
  discord: 'DC',
  ebay: 'EB',
  whatnot: 'WN',
  'in-person': 'IRL',
  noditto: 'ND',
  other: '···',
  x: 'X',
  youtube: 'YT',
  tiktok: 'TT',
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
): Promise<Map<string, { handle: string; platform: string }>> {
  const map = new Map<string, { handle: string; platform: string }>();
  if (profileIds.length === 0) return map;
  const { data } = await admin
    .from('social_claims')
    .select('platform, handle, claimed_profile_id')
    .in('claimed_profile_id', profileIds);
  for (const row of data ?? []) {
    if (row.claimed_profile_id && !map.has(row.claimed_profile_id)) {
      map.set(row.claimed_profile_id, { handle: `@${row.handle}`, platform: row.platform });
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
  role: string;
  occurredMonth: string;
  deals: number;
  proofStatus: string;
  hasEscrow: boolean;
}

/** Incoming counts (positive people, negative people, own refs) per profile id. */
async function incomingCounts(
  admin: Admin,
  profileIds: string[],
): Promise<Map<string, { positive: number; negative: number }>> {
  const counts = new Map<string, { positive: number; negative: number }>();
  if (profileIds.length === 0) return counts;
  const [{ data: edges }, { data: reviews }] = await Promise.all([
    admin.from('reference_edges_public').select('voucher_id, target_profile_id, sentiment').in('target_profile_id', profileIds).limit(5000),
    admin.from('reviews').select('reviewer_id, reviewee_id').in('reviewee_id', profileIds).limit(5000),
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
  target: { profileId: string | null; claimId: string | null },
): Promise<MergedEdge[]> {
  const edgesPromise = target.profileId
    ? admin.from('reference_edges_public').select('*').eq('target_profile_id', target.profileId).limit(500)
    : admin.from('reference_edges_public').select('*').eq('target_claim_id', target.claimId!).limit(500);
  const reviewsPromise = target.profileId
    ? admin.from('reviews').select('reviewer_id, created_at').eq('reviewee_id', target.profileId).limit(500)
    : Promise.resolve({ data: [] as { reviewer_id: string; created_at: string }[] });

  const [{ data: edges }, { data: reviews }] = await Promise.all([edgesPromise, reviewsPromise]);

  const byVoucher = new Map<string, MergedEdge>();
  for (const edge of edges ?? []) {
    const key = `${edge.voucher_id}:${edge.sentiment}`;
    const existing = byVoucher.get(key);
    if (existing) {
      existing.deals += edge.deal_count;
      continue;
    }
    byVoucher.set(key, {
      voucherId: edge.voucher_id,
      sentiment: edge.sentiment,
      categoryLabel: negativeCategoryLabel(edge.category),
      comment: edge.comment,
      platform: edge.platform,
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
    } else {
      byVoucher.set(key, {
        voucherId: review.reviewer_id,
        sentiment: 'POSITIVE',
        categoryLabel: null,
        comment: null,
        platform: 'noditto',
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
  centre: Omit<ReferenceGraphCentre, 'referenceCount' | 'peopleCount' | 'negativeCount' | 'checkedCount'>,
  target: { profileId: string | null; claimId: string | null },
): Promise<ReferenceGraphData> {
  const merged = await mergedIncoming(admin, target);
  const positives = merged.filter((e) => e.sentiment === 'POSITIVE');
  const negatives = merged.filter((e) => e.sentiment === 'NEGATIVE');

  const refereeIds = Array.from(new Set(merged.map((e) => e.voucherId)));
  const [profiles, handles, counts] = await Promise.all([
    refereeProfiles(admin, refereeIds),
    primaryHandles(admin, refereeIds),
    incomingCounts(admin, refereeIds),
  ]);

  // Second degree: who references each referee (positive only, top 2 each).
  const secondDegree = refereeIds.length
    ? await mergedIncomingMulti(admin, refereeIds)
    : new Map<string, MergedEdge[]>();

  const ranked = [...positives, ...negatives]
    .filter((edge) => profiles.has(edge.voucherId))
    .sort((a, b) => {
      if (a.sentiment !== b.sentiment) return a.sentiment === 'POSITIVE' ? -1 : 1;
      return (counts.get(b.voucherId)?.positive ?? 0) - (counts.get(a.voucherId)?.positive ?? 0);
    })
    .slice(0, 14);

  const placed = layoutRing(
    ranked.map((edge) => ({ id: `${edge.voucherId}:${edge.sentiment}`, weight: counts.get(edge.voucherId)?.positive ?? 0 })),
    CENTRE_X,
    CENTRE_Y,
    252,
  );
  const placedById = new Map<string, PlacedNode>(placed.map((p) => [p.id, p]));

  const childInputs: { id: string; parentId: string; weight: number }[] = [];
  const childEdges = new Map<string, MergedEdge & { parentId: string }>();
  for (const edge of ranked) {
    if (edge.sentiment === 'NEGATIVE') continue;
    const kids = (secondDegree.get(edge.voucherId) ?? [])
      .filter((kid) => kid.voucherId !== centre.profileId && profiles.has(kid.voucherId))
      .slice(0, 2);
    for (const kid of kids) {
      const id = `${edge.voucherId}>${kid.voucherId}`;
      childInputs.push({ id, parentId: `${edge.voucherId}:POSITIVE`, weight: counts.get(kid.voucherId)?.positive ?? 0 });
      childEdges.set(id, { ...kid, parentId: `${edge.voucherId}:POSITIVE` });
    }
  }
  const placedChildren = layoutChildren(childInputs, placedById, CENTRE_X, CENTRE_Y);
  const parentByChildId = new Map(childInputs.map((c) => [c.id, c.parentId]));
  const childrenByParent = new Map<string, ReferenceGraphChild[]>();
  for (const child of placedChildren) {
    const edge = childEdges.get(child.id);
    const parentId = parentByChildId.get(child.id);
    if (!edge || !parentId) continue;
    const profile = profiles.get(edge.voucherId);
    const handle = handles.get(edge.voucherId);
    const entry: ReferenceGraphChild = {
      id: child.id,
      profileId: edge.voucherId,
      handle: handle?.handle ?? profile?.displayName ?? 'Member',
      initials: initialsOf(handle?.handle ?? profile?.displayName ?? '?'),
      refs: counts.get(edge.voucherId)?.positive ?? 0,
      x: child.x,
      y: child.y,
      r: child.r,
      parentId,
    };
    const list = childrenByParent.get(parentId) ?? [];
    list.push(entry);
    childrenByParent.set(parentId, list);
  }

  const nodes: ReferenceGraphNode[] = ranked.flatMap((edge) => {
    const place = placedById.get(`${edge.voucherId}:${edge.sentiment}`);
    const profile = profiles.get(edge.voucherId);
    if (!place || !profile) return [];
    const handle = handles.get(edge.voucherId);
    return [
      {
        id: `${edge.voucherId}:${edge.sentiment}`,
        profileId: edge.voucherId,
        handle: handle?.handle ?? profile.displayName,
        name: profile.displayName,
        initials: initialsOf(handle?.handle ?? profile.displayName),
        refs: counts.get(edge.voucherId)?.positive ?? 0,
        platform: edge.platform,
        platformShort: PLATFORM_SHORT[edge.platform] ?? '···',
        kind: edge.hasEscrow ? 'escrow' : edge.proofStatus === 'CHECKED' ? 'receipt' : 'vouch',
        sentiment: edge.sentiment,
        categoryLabel: edge.categoryLabel,
        comment: edge.comment,
        role: edge.role,
        roleLabel: roleLabel(edge.role),
        dateLabel: formatOccurredMonth(edge.occurredMonth),
        deals: edge.deals,
        x: place.x,
        y: place.y,
        r: place.r,
        children: childrenByParent.get(`${edge.voucherId}:POSITIVE`) ?? [],
      },
    ];
  });

  return {
    centre: {
      ...centre,
      referenceCount: positives.filter((e) => profiles.has(e.voucherId)).length,
      peopleCount: positives.filter((e) => profiles.has(e.voucherId)).length,
      negativeCount: negatives.filter((e) => profiles.has(e.voucherId)).length,
      checkedCount: positives.filter((e) => e.proofStatus === 'CHECKED' || e.hasEscrow).length,
    },
    nodes,
    width: GRAPH_VIEW_WIDTH,
    height: GRAPH_VIEW_HEIGHT,
    centreX: CENTRE_X,
    centreY: CENTRE_Y,
  };
}

/** Batched second-degree reads: incoming positive edges per referee. */
async function mergedIncomingMulti(
  admin: Admin,
  refereeIds: string[],
): Promise<Map<string, MergedEdge[]>> {
  const map = new Map<string, MergedEdge[]>();
  const [{ data: edges }, { data: reviews }] = await Promise.all([
    admin.from('reference_edges_public').select('*').in('target_profile_id', refereeIds).eq('sentiment', 'POSITIVE').limit(1000),
    admin.from('reviews').select('reviewer_id, reviewee_id, created_at').in('reviewee_id', refereeIds).limit(1000),
  ]);
  const push = (targetId: string, edge: MergedEdge) => {
    const list = map.get(targetId) ?? [];
    if (!list.some((e) => e.voucherId === edge.voucherId)) list.push(edge);
    map.set(targetId, list);
  };
  for (const edge of edges ?? []) {
    if (!edge.target_profile_id) continue;
    push(edge.target_profile_id, {
      voucherId: edge.voucher_id,
      sentiment: 'POSITIVE',
      categoryLabel: null,
      comment: null,
      platform: edge.platform,
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
      comment: null,
      platform: 'noditto',
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
      .select('id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, created_at')
      .eq('id', profileId)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .maybeSingle(),
    admin.from('social_claims').select('platform, handle').eq('claimed_profile_id', profileId).limit(1),
  ]);
  if (!profile) return null;
  const claim = claims?.[0];
  return assembleGraph(
    admin,
    {
      kind: 'profile',
      id: profile.id,
      profileId: profile.id,
      handle: claim ? `@${claim.handle}` : profile.display_name,
      name: profile.display_name,
      firstName:
        profile.identity_check_status === 'VERIFIED' ? firstGivenName(profile.identity_check_name) : null,
      identityVerified: profile.identity_check_status === 'VERIFIED',
      regionCode: profile.region_code,
      avatarPath: profile.avatar_path,
      memberSince: profile.created_at,
      unclaimed: false,
    },
    { profileId: profile.id, claimId: null },
  );
}

export async function loadClaimReferenceGraph(claimId: string): Promise<ReferenceGraphData | null> {
  const admin = createAdminClient();
  const { data: claim } = await admin
    .from('social_claims')
    .select('id, platform, handle, claimed_profile_id')
    .eq('id', claimId)
    .maybeSingle();
  if (!claim || claim.claimed_profile_id) return null;
  return assembleGraph(
    admin,
    {
      kind: 'claim',
      id: claim.id,
      profileId: null,
      handle: `@${claim.handle}`,
      name: claim.handle,
      firstName: null,
      identityVerified: false,
      regionCode: null,
      avatarPath: null,
      memberSince: null,
      unclaimed: true,
    },
    { profileId: null, claimId: claim.id },
  );
}

export { platformLabel };
