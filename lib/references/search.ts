import 'server-only';

// lib/references/search.ts
//
// Reference search (0155): the suggestions behind `/references` and the header search.
// The member-facing door is the `searchReferences` Server Action, which adds the rate
// limit; the `/references` page reads `cachedTopSuggestions` directly, so rendering the
// page never spends a visitor's search allowance.
//
// A member appears once, with every platform they have a claimed handle or a reference
// on. An unclaimed handle appears on its own platform, never merged with a same-spelled
// handle elsewhere. Counts are `peopleTallies`, the same read the graph pages use.

import { unstable_cache } from 'next/cache';

import { REFERENCES_CACHE_TAG } from '@/lib/references/cacheTag';
import {
  EMPTY_TALLY,
  claimKey,
  peopleTallies,
  profileKey,
  rowsOrThrow,
  tallyLivePeople,
} from '@/lib/references/people';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimAddress, type ReferenceAddress } from '@/domain/references/address';
import {
  displayNameLabel,
  sentimentForRating,
  type PeopleTallyEntry,
  type ReferenceSentiment,
} from '@/domain/references/reference';

type Admin = ReturnType<typeof createAdminClient>;

/** One autofill suggestion: a member, or one unclaimed handle on its own platform. */
export interface ReferenceSuggestion {
  kind: 'profile' | 'claim';
  /** profiles.id when claimed, social_claims.id when not. */
  id: string;
  /** A member's claimed and dealt-on platforms; an unclaimed handle's one platform. */
  platforms: string[];
  /** `@handle`, or a member's display name when they have no claimed handle. */
  handle: string;
  /** Their page. */
  address: ReferenceAddress;
  /** NoDitto display name, or the claim's handle when unclaimed. */
  name: string;
  regionCode: string | null;
  avatarPath: string | null;
  /** How many different people had a good experience of them (`peopleTallies`). */
  referenceCount: number;
}

const SUGGESTION_LIMIT = 8;

interface ClaimMatch {
  id: string;
  platform: string;
  handle: string;
  claimed_profile_id: string | null;
}

/** `text` as a literal inside an ILIKE pattern, so `%` and `_` match only themselves. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The search box's text as a needle: no `@`, lower case, bounded. */
export function searchNeedle(query: string): string {
  return (query ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 64);
}

/** Suggestions for a typed needle. Throws on a failed read. */
export async function searchSuggestions(needle: string): Promise<ReferenceSuggestion[]> {
  if (!needle) return cachedTopSuggestions();
  const admin = createAdminClient();
  const pattern = `%${likeLiteral(needle)}%`;
  const [claimResult, nameResult] = await Promise.all([
    admin
      .from('social_claims')
      .select('id, platform, handle, claimed_profile_id')
      .ilike('handle', pattern)
      .order('handle', { ascending: true })
      .limit(60),
    admin
      .from('profiles')
      .select('id')
      .ilike('display_name', pattern)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .limit(40),
  ]);
  return buildSuggestions(
    admin,
    rowsOrThrow(nameResult, 'search names').map((row) => row.id),
    rowsOrThrow(claimResult, 'search handles'),
    needle,
  );
}

/**
 * The no-query suggestions, the `/references` landing list: the same for everyone, so
 * shared across requests, and expired with every other cached reference read. A failed
 * read throws rather than returning, so a failure is never cached.
 */
export const cachedTopSuggestions = unstable_cache(
  async (): Promise<ReferenceSuggestion[]> => {
    const admin = createAdminClient();
    const top = await mostReferenced(admin);
    const claims = top.claimIds.length
      ? rowsOrThrow(
          await admin
            .from('social_claims')
            .select('id, platform, handle, claimed_profile_id')
            .in('id', top.claimIds),
          'most-referenced handles',
        )
      : [];
    return buildSuggestions(admin, top.profileIds, claims, '');
  },
  ['references-top'],
  { tags: [REFERENCES_CACHE_TAG], revalidate: 300 },
);

/**
 * The people and handles the most people had a good experience of, among the latest
 * references and reviews. Only picks candidates; `buildSuggestions` counts them in full.
 */
async function mostReferenced(admin: Admin): Promise<{ profileIds: string[]; claimIds: string[] }> {
  const [edges, reviews] = await Promise.all([
    admin
      .from('reference_edges_public')
      .select('voucher_id, target_profile_id, target_claim_id, sentiment')
      .eq('sentiment', 'POSITIVE')
      .order('created_at', { ascending: false })
      .limit(2000),
    admin
      .from('reviews')
      .select('reviewer_id, reviewee_id, rating')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);
  const entries: PeopleTallyEntry[] = [];
  for (const edge of rowsOrThrow(edges, 'most-referenced references')) {
    const target = edge.target_profile_id
      ? profileKey(edge.target_profile_id)
      : edge.target_claim_id
        ? claimKey(edge.target_claim_id)
        : null;
    if (target) entries.push({ target, person: edge.voucher_id, sentiment: edge.sentiment as ReferenceSentiment });
  }
  for (const review of rowsOrThrow(reviews, 'most-referenced reviews')) {
    entries.push({
      target: profileKey(review.reviewee_id),
      person: review.reviewer_id,
      sentiment: sentimentForRating(review.rating),
    });
  }
  const tallies = await tallyLivePeople(admin, entries);
  const top = Array.from(tallies.entries())
    .filter(([, tally]) => tally.positive > 0)
    .sort((a, b) => b[1].positive - a[1].positive)
    .slice(0, SUGGESTION_LIMIT * 3)
    .map(([key]) => key);
  return {
    profileIds: top.filter((key) => key.startsWith('p:')).map((key) => key.slice(2)),
    claimIds: top.filter((key) => key.startsWith('c:')).map((key) => key.slice(2)),
  };
}

async function buildSuggestions(
  admin: Admin,
  namedProfileIds: string[],
  claims: readonly ClaimMatch[],
  needle: string,
): Promise<ReferenceSuggestion[]> {
  // The handle a member was found by, so a search for their Discord name shows it.
  const matchedHandle = new Map<string, ClaimMatch>();
  for (const claim of claims) {
    if (claim.claimed_profile_id && !matchedHandle.has(claim.claimed_profile_id)) {
      matchedHandle.set(claim.claimed_profile_id, claim);
    }
  }
  const profileIds = Array.from(new Set([...matchedHandle.keys(), ...namedProfileIds]));
  const unclaimed = claims.filter((claim) => !claim.claimed_profile_id);
  const unclaimedIds = unclaimed.map((claim) => claim.id);

  const none = { data: [], error: null };
  const [profiles, profileClaims, profileEdges, reviews, tallies] = await Promise.all([
    profileIds.length
      ? admin
          .from('profiles')
          .select('id, display_name, region_code, avatar_path')
          .in('id', profileIds)
          .is('fraud_banned_at', null)
          .is('closed_at', null)
      : Promise.resolve(none),
    profileIds.length
      ? admin
          .from('social_claims')
          .select('id, platform, handle, claimed_profile_id')
          .in('claimed_profile_id', profileIds)
          .order('claimed_at', { ascending: true })
      : Promise.resolve(none),
    profileIds.length
      ? admin
          .from('reference_edges_public')
          .select('target_profile_id, platform')
          .in('target_profile_id', profileIds)
          .limit(5000)
      : Promise.resolve(none),
    profileIds.length
      ? admin.from('reviews').select('reviewee_id').in('reviewee_id', profileIds).limit(5000)
      : Promise.resolve(none),
    peopleTallies(admin, { profileIds, claimIds: unclaimedIds }),
  ]);

  // Which platforms each member is known on: their claimed handles and their deals.
  const platformsFor = new Map<string, Set<string>>();
  const note = (key: string, value: string) => {
    const set = platformsFor.get(key) ?? new Set<string>();
    set.add(value);
    platformsFor.set(key, set);
  };
  const claimsOf = new Map<string, ClaimMatch[]>();
  for (const claim of rowsOrThrow<ClaimMatch>(profileClaims, 'suggestion handles')) {
    if (!claim.claimed_profile_id) continue;
    claimsOf.set(claim.claimed_profile_id, [...(claimsOf.get(claim.claimed_profile_id) ?? []), claim]);
    note(profileKey(claim.claimed_profile_id), claim.platform);
  }
  for (const edge of rowsOrThrow<{ target_profile_id: string | null; platform: string }>(
    profileEdges,
    'suggestion platforms',
  )) {
    if (edge.target_profile_id) note(profileKey(edge.target_profile_id), edge.platform);
  }
  for (const review of rowsOrThrow<{ reviewee_id: string }>(reviews, 'suggestion reviews')) {
    note(profileKey(review.reviewee_id), 'noditto');
  }
  const countOf = (key: string) => (tallies.get(key) ?? EMPTY_TALLY).positive;

  const score = (handle: string, name: string): number => {
    if (!needle) return 1;
    const h = handle.toLowerCase().replace(/^@/, '');
    const n = name.toLowerCase();
    if (h === needle || n === needle) return 0;
    if (h.startsWith(needle) || n.startsWith(needle)) return 1;
    if (h.includes(needle) || n.includes(needle)) return 2;
    return 3;
  };

  const ranked: (ReferenceSuggestion & { score: number })[] = [];
  for (const profile of rowsOrThrow<{
    id: string;
    display_name: string;
    region_code: string | null;
    avatar_path: string | null;
  }>(profiles, 'suggestion profiles')) {
    const shown = matchedHandle.get(profile.id) ?? claimsOf.get(profile.id)?.[0];
    const name = displayNameLabel(profile.display_name);
    const handle = shown ? `@${shown.handle}` : name;
    ranked.push({
      kind: 'profile',
      id: profile.id,
      platforms: Array.from(platformsFor.get(profileKey(profile.id)) ?? []),
      handle,
      address: shown ? claimAddress(shown) : { slug: profile.id, on: null },
      name,
      regionCode: profile.region_code ?? null,
      avatarPath: profile.avatar_path ?? null,
      referenceCount: countOf(profileKey(profile.id)),
      score: score(handle, name),
    });
  }
  for (const claim of unclaimed) {
    const handle = `@${claim.handle}`;
    ranked.push({
      kind: 'claim',
      id: claim.id,
      platforms: [claim.platform],
      handle,
      address: claimAddress(claim),
      name: claim.handle,
      regionCode: null,
      avatarPath: null,
      referenceCount: countOf(claimKey(claim.id)),
      score: score(handle, claim.handle),
    });
  }

  return ranked
    .filter((suggestion) => needle || suggestion.referenceCount > 0)
    .sort(
      (a, b) =>
        a.score - b.score || b.referenceCount - a.referenceCount || a.handle.localeCompare(b.handle),
    )
    .slice(0, SUGGESTION_LIMIT)
    .map(({ score: _score, ...rest }) => rest);
}
