// app/sitemap.ts
//
// Dynamic sitemap including published listings and active seller profiles.
// Individual listing pages are the primary organic traffic surface for a
// marketplace, so they must be crawlable.

import type { MetadataRoute } from 'next';
import { CARD_GAME_NAMES } from '@/lib/catalog/cardGames';
import { SITE_URL as siteUrl } from '@/lib/seo/site';
import { createAdminClient } from '@/lib/supabase/admin';

// The dynamic portion of the sitemap depends on the service-role Supabase
// client, which is unavailable at build time in environments without the admin
// env vars. Render this route on demand instead of prerendering it so the build
// never depends on those secrets.
export const dynamic = 'force-dynamic';

/**
 * Hard ceiling on listing URLs in this file.
 *
 * Google's limit is 50,000 URLs (or 50 MB uncompressed) per sitemap, and this
 * file also carries one seller URL per distinct owner, so the listing budget has
 * to leave room for those. Ordered by `updated_at` descending so that if the cap
 * is ever reached the FRESHEST listings are the ones submitted rather than an
 * arbitrary page of them.
 *
 * Past this point the fix is `generateSitemaps()` plus a hand-written index
 * route — note that Next serves split sitemaps at `/sitemap/[id].xml` and does
 * NOT synthesise an index at `/sitemap.xml`, so adopting it without writing that
 * index would break the `sitemap:` line in `app/robots.ts`.
 */
const MAX_LISTING_URLS = 40_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static routes. The root IS the catalog, so it changes hourly and carries
  // top priority; `/listings` is a permanent redirect and must stay out of the
  // sitemap.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${siteUrl}/sign-up`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/sign-in`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${siteUrl}/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/safety`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Fetch published listings. The admin client throws when its env vars are
  // absent (e.g. during a build without Supabase secrets); degrade gracefully to
  // the static routes rather than aborting sitemap generation.
  //
  // EVERY PREDICATE BELOW MIRRORS THE PUBLIC BRANCH OF `items_catalog_select`
  // (latest definition in migration 0108), because this client is SERVICE ROLE
  // and therefore bypasses the policy the listing page is subject to. A filter
  // that exists there and not here submits a URL that 404s for Googlebot, which
  // Search Console reports as a soft 404 against the whole property — and it is
  // invisible in development, where the seeded data trips none of these. Two
  // were missing and both had a live failure mode:
  //
  //   * `closed_at is null` — a CLOSED SHOPFRONT keeps `status = 'AVAILABLE'`
  //     (0064: a binder is never reserved and never sold, it is closed), so
  //     status alone let every retired binder stay in the sitemap while its page
  //     had started 404ing.
  //   * `seller_fraud_banned = false` — 0091 pulls a banned member's goods out
  //     of the catalog through this denormalised column. Without it the sitemap
  //     kept actively advertising the listings of accounts banned for confirmed
  //     fraud, which is the worst possible set to hand a crawler.
  let listings: Array<{ id: string; updated_at: string | null; owner_id: string }> | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('items')
      .select('id, updated_at, owner_id')
      // Deliberately narrower than the policy, which also admits RESERVED and
      // SOLD (0108) so those pages keep returning 200 for a URL already in the
      // index. Submitting them is a different question: SOLD is permanent, so
      // including it would grow this file without bound with pages that have no
      // buying intent left. Only what is actually for sale is submitted.
      .eq('status', 'AVAILABLE')
      .is('closed_at', null)
      .eq('seller_fraud_banned', false)
      .eq('hidden', false)
      .in('category', CARD_GAME_NAMES)
      .order('updated_at', { ascending: false })
      .limit(MAX_LISTING_URLS);
    listings = data;
  } catch {
    return staticRoutes;
  }

  const listingRoutes: MetadataRoute.Sitemap = (listings ?? []).map((item) => ({
    url: `${siteUrl}/listings/${item.id}`,
    lastModified: item.updated_at ? new Date(item.updated_at as string) : now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Unique seller profiles with active listings.
  const sellerIds = Array.from(new Set((listings ?? []).map((item) => item.owner_id as string)));
  const sellerRoutes: MetadataRoute.Sitemap = sellerIds.map((id) => ({
    url: `${siteUrl}/sellers/${id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  return [...staticRoutes, ...listingRoutes, ...sellerRoutes];
}
