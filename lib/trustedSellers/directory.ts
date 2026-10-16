import 'server-only';

// lib/trustedSellers/directory.ts
//
// The public Trusted Seller directory on `/trusted-sellers` (0152).
//
// WHAT IT PUBLISHES, AND NOTHING ELSE. Every field comes from `discoverable_profiles`,
// which is already anon-readable and already omits closed accounts:
//   * display name, avatar, rating, country
//   * the provider-verified GIVEN name (`identity_first_name`), never the full legal
//     name — the same disclosure `IdentityBadge` already makes on every listing
//   * their primary public profile link (Instagram when present), shown as the row's
//     headline
// plus a count of their live listings. No staff notes, no review data, no surname.
//
// TRUST IS READ, NOT STORED. `is_trusted_seller` is derived from the review by
// trigger, so a revoked or banned seller leaves the directory with no write here.
// The read is cached for {@link DIRECTORY_REVALIDATE_SECONDS}; decisions and bans drop
// {@link TRUSTED_DIRECTORY_CACHE_TAG} so they show at once.
//
// Anon client, no cookies, so the read can sit in `unstable_cache`.

import { unstable_cache } from 'next/cache';

import { publicCatalogClient } from '@/lib/supabase/public';
import { CARD_GAME_NAMES } from '@/lib/catalog/cardGames';
import { parseSocialLinks } from '@/domain/social/socialLinks';
import { itemImageUrl } from '@/lib/format';

export const TRUSTED_DIRECTORY_CACHE_TAG = 'trusted-seller-directory';

const DIRECTORY_REVALIDATE_SECONDS = 300;
/** The page lists this many at most. Comfortably above any near-term count. */
const DIRECTORY_LIMIT = 200;

/** One seller as the directory shows them. */
export interface TrustedSellerDirectoryEntry {
  id: string;
  displayName: string;
  /** Provider-verified given name only. Null for a member with none on file. */
  firstName: string | null;
  identityVerified: boolean;
  avatarPath: string | null;
  rating: number | null;
  ratingCount: number;
  regionCode: string | null;
  /** `public_profiles.member_since`: the account's creation MONTH, never a timestamp. */
  memberSince: string | null;
  /**
   * Where to find them, from their public profile links, and the directory row's
   * headline: Instagram when they have it, else the first link in registry order.
   * Null only if they have no public links.
   * `url` is null for a platform with no public profile URL (Discord).
   */
  contact: { slug: string; label: string; handle: string; url: string | null } | null;
  liveListings: number;
  /** Their newest live listings with a photo, at most {@link PREVIEW_PER_SELLER}. */
  previews: { id: string; title: string; imageUrl: string }[];
}

/** How many listing photos a directory row shows. */
const PREVIEW_PER_SELLER = 4;

async function readDirectory(): Promise<TrustedSellerDirectoryEntry[]> {
  const supabase = publicCatalogClient();
  const { data: sellers, error } = await supabase
    .from('discoverable_profiles')
    .select(
      'id, display_name, identity_first_name, is_verified, avatar_path, rating, rating_count, region_code, social_links, member_since',
    )
    .eq('is_trusted_seller', true)
    .limit(DIRECTORY_LIMIT);
  // THROWN, not returned empty: `unstable_cache` would otherwise keep "no sellers"
  // for the whole window after one failed read.
  if (error) throw new Error(`[trusted directory] sellers: ${error.message}`);

  const rows = sellers ?? [];
  if (rows.length === 0) return [];

  // The same visibility rule the catalog applies, so the count matches what a buyer
  // finds on the seller's page.
  const { data: listings, error: listingsError } = await supabase
    .from('items')
    .select('id, owner_id, title, image_paths, created_at')
    .in(
      'owner_id',
      rows.map((row) => row.id),
    )
    .eq('status', 'AVAILABLE')
    .eq('hidden', false)
    .is('closed_at', null)
    .in('category', CARD_GAME_NAMES)
    // Newest first, so each seller's previews are what they listed most recently.
    .order('created_at', { ascending: false })
    .limit(10_000);
  if (listingsError) throw new Error(`[trusted directory] listings: ${listingsError.message}`);

  const live = new Map<string, number>();
  const previews = new Map<string, TrustedSellerDirectoryEntry['previews']>();
  for (const row of listings ?? []) {
    const owner = row.owner_id as string;
    live.set(owner, (live.get(owner) ?? 0) + 1);
    const imageUrl = itemImageUrl((row.image_paths as string[] | null)?.[0]);
    const mine = previews.get(owner) ?? [];
    if (imageUrl && mine.length < PREVIEW_PER_SELLER) {
      mine.push({ id: row.id as string, title: row.title as string, imageUrl });
      previews.set(owner, mine);
    }
  }

  const entries = rows.map((row): TrustedSellerDirectoryEntry => {
    const links = parseSocialLinks((row.social_links as Record<string, string> | null) ?? null);
    // Instagram when they have it, else the first link on their profile.
    const primary = links.find((link) => link.slug === 'instagram') ?? links[0] ?? null;
    return {
      id: row.id,
      displayName: row.display_name,
      firstName: row.identity_first_name,
      identityVerified: Boolean(row.is_verified),
      avatarPath: row.avatar_path,
      rating: row.rating,
      ratingCount: row.rating_count ?? 0,
      regionCode: row.region_code,
      memberSince: row.member_since,
      contact: primary
        ? { slug: primary.slug, label: primary.label, handle: primary.handle, url: primary.url }
        : null,
      liveListings: live.get(row.id) ?? 0,
      previews: previews.get(row.id) ?? [],
    };
  });

  // Most-reviewed first, then best-rated, then name: the order a buyer would rank
  // them in, and stable between requests.
  return entries.sort(
    (a, b) =>
      b.ratingCount - a.ratingCount ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.displayName.localeCompare(b.displayName),
  );
}

/** The directory, cached. Throws when the read fails; the page reports that. */
export const loadTrustedSellerDirectory = unstable_cache(
  readDirectory,
  // v4: `contact` (any platform) replaces `instagram`.
  ['trusted-seller-directory-v4'],
  { revalidate: DIRECTORY_REVALIDATE_SECONDS, tags: [TRUSTED_DIRECTORY_CACHE_TAG] },
);
