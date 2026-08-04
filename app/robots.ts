// app/robots.ts
//
// Robots policy. Public marketplace and marketing pages are indexable; the
// signed-in transactional surfaces (money, identity, private deals) are not.

import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/api/',
        '/deals',
        '/messages',
        '/notifications',
        '/offers',
        '/profile',
        '/purchases',
        '/sales',
        '/trades',
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
