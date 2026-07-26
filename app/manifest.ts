// app/manifest.ts
//
// Web app manifest so Poke-xchange installs cleanly as a PWA and gets a proper
// name, theme, and icon on mobile home screens.

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Poke-xchange - Protected Trades for Serious Collectors',
    short_name: 'Poke-xchange',
    description:
      'Buy, sell, and swap high-value collectibles with collateral-backed escrow.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4efe4',
    theme_color: '#0c0b0a',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
