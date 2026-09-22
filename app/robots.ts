// app/robots.ts
//
// Robots policy. Public marketplace and marketing pages are indexable; the
// signed-in transactional surfaces (money, identity, private deals) are not.

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Prefix matches, so `/listings/new` also covers anything beneath it. That
      // is safe alongside the public `/listings/[id]`: ids are UUIDs, which
      // cannot begin with `new` or `mine`.
      disallow: [
        '/admin',
        '/api/',
        '/messages',
        '/notifications',
        '/offers',
        '/profile',
        '/purchases',
        '/sales',
        '/trades',
        '/deals',
        '/t/',
        // Below: signed-in or single-use surfaces that already redirect a
        // cookie-less crawler to /sign-in. Nothing leaks without these — the
        // point is crawl budget. Every one of them was being fetched, redirected
        // and discarded on a site whose indexable surface is listings, and a
        // marketplace wants that budget spent discovering stock.
        '/account',
        '/account-suspended',
        '/auth/',
        '/identity/',
        '/onboarding',
        '/saved',
        '/listings/new',
        '/listings/mine',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
