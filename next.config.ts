import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a production build run without fighting a `next dev` server for `.next`.
  // On Windows the dev server holds `.next/trace` open, so `next build` dies with
  // EPERM before it compiles anything — which reads like a code failure and is not
  // one. Set NEXT_BUILD_DIR to build into a scratch directory instead:
  //   $env:NEXT_BUILD_DIR='.next-build'; npm run build
  // Unset (the normal case, including on Vercel) it is the default `.next`.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.noditto.app' }],
        destination: 'https://noditto.app/:path*',
        permanent: true,
      },
    ];
  },
  // NOTE: `serverActions.bodySizeLimit` is deliberately left at the 1 MB default.
  // Every photo path in the app (listings, unlisted trade items, deal goods) now
  // uploads browser → Supabase Storage through a signed URL and sends only the
  // object path to the action (`lib/storage/uploadItemImages.ts`), so no action
  // body carries file bytes. Raising the limit would only widen how much a
  // request can make the server buffer in memory.
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

