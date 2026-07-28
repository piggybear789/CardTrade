import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
        pathname: '/**',
      },
      {
        // Newer TCG sets (Mega Evolution era onward) serve card scans from
        // Scrydex instead of images.pokemontcg.io.
        protocol: 'https',
        hostname: 'images.scrydex.com',
        pathname: '/pokemon/**',
      },
    ],
  },
};

export default nextConfig;

