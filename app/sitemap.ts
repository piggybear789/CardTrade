// app/sitemap.ts
//
// Dynamic sitemap including published listings and active seller profiles.
// Individual listing pages are the primary organic traffic surface for a
// marketplace, so they must be crawlable.

import type { MetadataRoute } from 'next';
import { CARD_GAME_NAMES } from '@/lib/catalog/cardGames';
import { createAdminClient } from '@/lib/supabase/admin';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static routes
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/listings`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${siteUrl}/sign-up`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/sign-in`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${siteUrl}/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Fetch published listings.
  const admin = createAdminClient();
  const { data: listings } = await admin
    .from('items')
    .select('id, updated_at, owner_id')
    .eq('status', 'AVAILABLE')
    .eq('hidden', false)
    .in('category', CARD_GAME_NAMES);

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
