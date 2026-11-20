import 'server-only';

// lib/enrichment/instagramProfile.ts
//
// Reads visible Instagram profile metadata (followers, following, posts, is_private,
// category, bio) via SocialCrawl (`instagram/profile`, 1 credit) when SOCIALCRAWL_API_KEY
// is configured, plus a free Wayback Machine CDX earliest-snapshot check.
//
// Never throws — gracefully returns null when unconfigured or rate-limited.

import type { VisibleProfileMetrics } from '@/domain/references/profileForensics';

interface SocialCrawlProfileEnvelope {
  success?: boolean;
  data?: {
    author?: {
      username?: string | null;
      full_name?: string | null;
      name?: string | null;
      bio?: string | null;
      biography?: string | null;
      followers?: number | null;
      following?: number | null;
      posts?: number | null;
      media_count?: number | null;
      is_private?: boolean | null;
      is_verified?: boolean | null;
      category?: string | null;
      category_name?: string | null;
      ext?: {
        is_private?: boolean | null;
        category_name?: string | null;
        media_count?: number | null;
        following_count?: number | null;
        follower_count?: number | null;
        biography?: string | null;
      };
    };
  };
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * Fetches visible Instagram profile features via SocialCrawl (1 credit, cached by run TTL).
 * Returns null if `SOCIALCRAWL_API_KEY` is not set or the profile cannot be read.
 */
export async function fetchInstagramVisibleProfile(
  rawHandle: string,
): Promise<VisibleProfileMetrics | null> {
  const apiKey = process.env.SOCIALCRAWL_API_KEY?.trim();
  if (!apiKey) return null;

  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null;

  const url = new URL('https://www.socialcrawl.dev/v1/instagram/profile');
  url.searchParams.set('handle', handle);

  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(7_000),
  }).catch(() => null);

  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as SocialCrawlProfileEnvelope | null;
  const author = json?.success ? json.data?.author : null;
  if (!author) return null;

  const ext = author.ext;
  return {
    platform: 'instagram',
    handle: (author.username ?? handle).toLowerCase(),
    displayName: author.full_name ?? author.name ?? null,
    postsCount: asInt(author.posts ?? author.media_count ?? ext?.media_count),
    followersCount: asInt(author.followers ?? ext?.follower_count),
    followingCount: asInt(author.following ?? ext?.following_count),
    isPrivate:
      typeof author.is_private === 'boolean'
        ? author.is_private
        : typeof ext?.is_private === 'boolean'
          ? ext.is_private
          : null,
    category: author.category_name ?? author.category ?? ext?.category_name ?? null,
    bio: author.bio ?? author.biography ?? ext?.biography ?? null,
    isVerified: typeof author.is_verified === 'boolean' ? author.is_verified : null,
    source: 'API',
  };
}

/**
 * Free Wayback Machine CDX check: returns `YYYY-MM` of earliest archive snapshot if any.
 * Bounded to 3.5s so slow archive.org responses never stall a background check.
 */
export async function lookupWaybackFirstSeen(profileUrl: string): Promise<string | null> {
  const clean = profileUrl.trim().replace(/^https?:\/\//i, '');
  if (!clean) return null;

  const url = new URL('https://web.archive.org/cdx/search/cdx');
  url.searchParams.set('url', clean);
  url.searchParams.set('output', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('fl', 'timestamp');

  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3_500),
  }).catch(() => null);
  if (!res?.ok) return null;

  const rows = (await res.json().catch(() => null)) as string[][] | null;
  const ts = rows?.[1]?.[0];
  if (!ts || ts.length < 6) return null;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}`;
}
