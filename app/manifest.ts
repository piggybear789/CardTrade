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
      'DittoShield verification, collateral-backed contracts, and Stripe payments for collectors.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4efe4',
    theme_color: '#0c0b0a',
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
