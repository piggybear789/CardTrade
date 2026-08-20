// Environment variables used by this config and related integrations:
// - NEXT_BUILD_DIR: optional scratch directory for `next build` (avoids EPERM on Windows)

import type { NextConfig } from 'next';

// Content-Security-Policy directives. Kept as an array for readability; joined
// into a single header value at build time.
const cspDirectives = [
  "default-src 'self'",
  // Next.js runtime requires unsafe-inline and unsafe-eval for its script
  // injection and hot-reload in development. Stripe Elements and Google Maps
  // load from their own origins.
  //
  // STRIPE SERVES THREE DIFFERENT SCRIPT ORIGINS AND CONNECT IS NOT ON js.stripe.com.
  // Connect embedded onboarding (`@stripe/connect-js`) injects
  // `https://connect-js.stripe.com/v1.0/connect.js`, so listing js.stripe.com alone
  // blocked it — the injected <script> fired `error`, the SDK rejected with
  // "Failed to load Connect.js", and because every internal `.then()` on that promise
  // is unhandled the failure arrived as a wall of unhandledRejection noise with a
  // blank panel on the page rather than as one legible error. `*.js.stripe.com` is
  // Stripe's own recommendation: Stripe.js starts frames on per-feature subdomains.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com https://maps.googleapis.com",
  // Tailwind injects styles at runtime; unsafe-inline is required.
  //
  // Connect embedded components are documented as needing a style-src HASH (the SHA of
  // an empty style element). DO NOT ADD IT: a hash or nonce in `style-src` makes
  // browsers IGNORE 'unsafe-inline' for that directive, which would block every inline
  // style Tailwind and Next emit. 'unsafe-inline' already permits the empty element.
  "style-src 'self' 'unsafe-inline'",
  // `*.stripe.com` covers the icons and brand assets Connect embedded components and
  // Stripe Elements load from their own CDN hosts.
  "img-src 'self' data: blob: https://*.stripe.com https://images.pokemontcg.io https://images.scrydex.com https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com",
  "font-src 'self'",
  // GOOGLE SERVES MAPS FROM TWO DIFFERENT HOSTS AND ONLY ONE OF THEM IS `maps.`.
  // Places API (New) — the autocomplete and Place Details calls behind
  // `PlaceSearch` — is `places.googleapis.com`; the Static Maps image is
  // `maps.googleapis.com`. Listing the latter alone blocked every address lookup
  // in the browser while the image still loaded, and `searchPlaces` catches the
  // rejection and returns no results, so the field looked unwired rather than
  // blocked. Keep both.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://maps.googleapis.com https://places.googleapis.com",
  // Stripe Elements and Payment Element render inside iframes; Google Maps
  // embed does too. Connect embedded onboarding renders its own iframes from
  // connect-js.stripe.com AND js.stripe.com, so both are required — the component
  // paints blank if either is missing.
  "frame-src https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com https://hooks.stripe.com https://www.google.com https://maps.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Suppress the X-Powered-By: Next.js header — leaks framework version info.
  poweredByHeader: false,
  // Lets a production build run without fighting a `next dev` server for `.next`.
  // On Windows the dev server holds `.next/trace` open, so `next build` dies with
  // EPERM before it compiles anything — which reads like a code failure and is not
  // one. Set NEXT_BUILD_DIR to build into a scratch directory instead:
  //   $env:NEXT_BUILD_DIR='.next-build'; npm run build
  // Unset (the normal case, including on Vercel) it is the default `.next`.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  async headers() {
    return [
      {
        // Apply security headers to every route.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            // Vercel sets HSTS at the edge, but defence in depth for any
            // non-Vercel deployment or proxied path.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: cspDirectives.join('; '),
          },
        ],
      },
    ];
  },
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
      {
        // Supabase Storage — item images, profile avatars, dispute evidence.
        // Routed through next/image so Vercel's edge CDN caches transformed
        // copies globally rather than every request hitting ap-northeast-1.
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
