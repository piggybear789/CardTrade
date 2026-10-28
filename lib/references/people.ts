import 'server-only';

// lib/references/people.ts
//
// How many different people had each kind of experience of someone: the ONE read behind
// every reference count (a page's headline, a planet's size, a search result, the
// `/references` landing list). The counting rule itself is `tallyPeople` in
// `domain/references/reference.ts`; this module only gathers its input.
//
// What counts:
//   * every LIVE reference, by its sentiment;
//   * every NoDitto review, read through `sentimentForRating` (a 1-star review is a bad
//     experience, never a vouch);
//   * only from people still on NoDitto: a banned or closed member's word is not counted
//     anywhere, exactly as the graph does not draw them.
//
// Keys are `p:<profileId>` for a member and `c:<claimId>` for an unclaimed handle.
//
// Reads run on the service role. A failed read THROWS, so a cached caller never stores
// a count of zero that is really an outage.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  sentimentForRating,
  tallyPeople,
  type PeopleTally,
  type PeopleTallyEntry,
  type ReferenceSentiment,
} from '@/domain/references/reference';

type Admin = ReturnType<typeof createAdminClient>;

/** Upper bound on rows read per query; a count past it under-reports rather than failing. */
const ROW_LIMIT = 5000;

/** How many ids go into one `in (...)` filter, to keep the request URL bounded. */
const ID_CHUNK = 200;

export const profileKey = (profileId: string) => `p:${profileId}`;
export const claimKey = (claimId: string) => `c:${claimId}`;

export const EMPTY_TALLY: PeopleTally = { positive: 0, neutral: 0, negative: 0 };

/** `data`, or a thrown error naming what failed. */
export function rowsOrThrow<T>(
  result: { data: T[] | null; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`[references] ${what}: ${result.error.message}`);
  return result.data ?? [];
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

/** The ids among `ids` that belong to a banned or closed member. */
export async function departedMembers(admin: Admin, ids: Iterable<string>): Promise<Set<string>> {
  const unique = Array.from(new Set(ids));
  const departed = new Set<string>();
  const results = await Promise.all(
    chunks(unique).map((chunk) =>
      admin
        .from('profiles')
        .select('id')
        .in('id', chunk)
        .or('fraud_banned_at.not.is.null,closed_at.not.is.null'),
    ),
  );
  for (const result of results) {
    for (const row of rowsOrThrow(result, 'departed members')) departed.add(row.id);
  }
  return departed;
}

/** Turns gathered experiences into tallies, leaving out people who have left. */
export async function tallyLivePeople(
  admin: Admin,
  entries: readonly PeopleTallyEntry[],
): Promise<Map<string, PeopleTally>> {
  const departed = await departedMembers(
    admin,
    entries.map((entry) => entry.person),
  );
  return tallyPeople(entries.filter((entry) => !departed.has(entry.person)));
}

/**
 * People tallies for each member in `profileIds` and each unclaimed handle in `claimIds`.
 * A target with no experiences has no entry; read it with `?? EMPTY_TALLY`.
 */
export async function peopleTallies(
  admin: Admin,
  target: { profileIds?: readonly string[]; claimIds?: readonly string[] },
): Promise<Map<string, PeopleTally>> {
  const profileIds = Array.from(new Set(target.profileIds ?? []));
  const claimIds = Array.from(new Set(target.claimIds ?? []));
  if (profileIds.length === 0 && claimIds.length === 0) return new Map();

  const [profileEdges, claimEdges, reviews] = await Promise.all([
    Promise.all(
      chunks(profileIds).map((chunk) =>
        admin
          .from('reference_edges_public')
          .select('voucher_id, target_profile_id, sentiment')
          .in('target_profile_id', chunk)
          .limit(ROW_LIMIT),
      ),
    ),
    Promise.all(
      chunks(claimIds).map((chunk) =>
        admin
          .from('reference_edges_public')
          .select('voucher_id, target_claim_id, sentiment')
          .in('target_claim_id', chunk)
          .limit(ROW_LIMIT),
      ),
    ),
    Promise.all(
      chunks(profileIds).map((chunk) =>
        admin
          .from('reviews')
          .select('reviewer_id, reviewee_id, rating')
          .in('reviewee_id', chunk)
          .limit(ROW_LIMIT),
      ),
    ),
  ]);

  const entries: PeopleTallyEntry[] = [];
  for (const result of profileEdges) {
    for (const edge of rowsOrThrow(result, 'profile reference counts')) {
      if (!edge.target_profile_id) continue;
      entries.push({
        target: profileKey(edge.target_profile_id),
        person: edge.voucher_id,
        sentiment: edge.sentiment as ReferenceSentiment,
      });
    }
  }
  for (const result of claimEdges) {
    for (const edge of rowsOrThrow(result, 'handle reference counts')) {
      if (!edge.target_claim_id) continue;
      entries.push({
        target: claimKey(edge.target_claim_id),
        person: edge.voucher_id,
        sentiment: edge.sentiment as ReferenceSentiment,
      });
    }
  }
  for (const result of reviews) {
    for (const review of rowsOrThrow(result, 'review counts')) {
      entries.push({
        target: profileKey(review.reviewee_id),
        person: review.reviewer_id,
        sentiment: sentimentForRating(review.rating),
      });
    }
  }
  return tallyLivePeople(admin, entries);
}
