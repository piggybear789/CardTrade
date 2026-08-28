// app/manifest.ts
//
// Web app manifest so NoDitto installs cleanly as a PWA and gets a proper
// name, theme, and icon on mobile home screens.

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NoDitto — Safer Collectible Deals',
    short_name: 'NoDitto',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for collectors.',
    start_url: '/',
    display: 'standalone',
    // The literal `--background` value. Keep in step with `viewport.themeColor`
    // in `app/layout.tsx`.
    background_color: '#ffffff',
    // The installed-app fallback for the same surface `viewport.themeColor`
    // gives a phone: the page, which is now white.
    theme_color: '#ffffff',
    icons: [
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
