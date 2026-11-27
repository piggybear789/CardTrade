import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { StartDealProvider } from '@/components/deals/StartDealProvider';
import { BodyPointerGuard } from '@/components/layout/BodyPointerGuard';
import { KeyboardInset } from '@/components/layout/KeyboardInset';
import { PageViewTracker } from '@/components/analytics/PageViewTracker';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { DisplayCurrencyBoundary } from '@/components/money/DisplayCurrencyBoundary';
import { Toaster } from '@/components/ui/sonner';
import { DEFAULT_OG_IMAGE, SITE_URL as siteUrl } from '@/lib/seo/site';
import './globals.css';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// ONE TYPEFACE: Inter. `next/font` self-hosts it under a hashed family name exposed
// as `--font-inter`, which `tailwind.config.ts` maps every font family onto.
//
// `display: 'swap'` stays explicit: `optional` once meant the brand face rarely
// rendered on a cold load.
//
// The `opsz` axis is what makes Inter read as designed rather than default: with
// `font-optical-sizing: auto` (the browser default) every heading from 21px up is
// drawn in Inter's display cut — tighter spacing, finer joins — while body copy
// keeps the text cut it was drawn for. No class has to opt in.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  axes: ['opsz'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Pages self-brand their titles as "<Section> · NoDitto", so this is only
  // the fallback for routes that don't set one — no title template, to avoid
  // double-suffixing those existing titles.
  title: 'NoDitto',
  description:
    'Buy, sell, and swap high-value collectibles with identity verification, collateral-backed contracts, and payments by Stripe.',
  applicationName: 'NoDitto',
  // NO BLANKET CANONICAL HERE. Next merges parent metadata into child, and pages
  // that set only `title`/`description` inherit everything else — so declaring
  // `canonical: '/'` at the root told crawlers that every page in the app was a
  // duplicate of the homepage. Each route states its own where it matters.
  keywords: [
    'collectibles',
    'trading cards',
    'anti-impostor verification',
    'marketplace',
    'card trading',
    'Stripe',
  ],
  openGraph: {
    type: 'website',
    siteName: 'NoDitto',
    title: 'NoDitto',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
    url: siteUrl,
    // `twitter.card: 'summary_large_image'` below asks a client to reserve a wide
    // image slot, and for as long as there was no image to put in it every share
    // of this site rendered as a link beside a blank rectangle. `/og` generates
    // one; see `app/og/route.tsx` for why it is a named route rather than the
    // `opengraph-image` file convention.
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NoDitto',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
    images: [DEFAULT_OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // The literal `--background` value. Phone and desktop chrome are both the page
  // surface, so the browser UI around them is one colour at every width.
  themeColor: '#ffffff',
  colorScheme: 'light',
  // Draw under notches/home indicators so the sticky header can pad itself
  // with safe-area insets instead of leaving a hardware-coloured gap.
  viewportFit: 'cover',
  // When the virtual keyboard opens, shrink the layout viewport so fixed/sticky
  // elements reposition instead of being hidden behind the keyboard.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={inter.variable}
    >
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" />
        <link rel="preconnect" href="https://images.scrydex.com" />
        {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
        ) : null}
      </head>
      {/* `data-fits-viewport` on a page (the References landing) caps the body at one
          screen, so that page's flex chain shrinks to fit instead of scrolling. */}
      <body className="flex min-h-dvh flex-col has-[[data-fits-viewport]]:h-dvh">
        <StartDealProvider>
          {/* NO SUSPENSE AROUND THE HEADER. Behind `<Suspense fallback={null}>` it
              streamed as its own segment and React revealed it after the page body
              had painted, so on a phone every hard load pushed `#main-content` down
              by the 54px strip (measured on production, 2026-11-23: one 0.064 shift
              per page, guest or member). The header now renders with the shell. It
              costs only its own reads, which run alongside the page's: the auth read
              is the request-cached one the page and layouts already await, and the
              notifications and profile reads run in parallel. */}
          {/* The viewer's currency and the day's reference rates (0179), so browse
              prices can be shown approximately in it. Around the header too: its search
              suggestions show prices. */}
          <DisplayCurrencyBoundary>
            <SiteHeader />
            <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col scroll-mt-[calc(3rem+env(safe-area-inset-top))] focus:outline-none md:scroll-mt-[calc(4rem+1px+env(safe-area-inset-top))]">
              {children}
            </div>
          </DisplayCurrencyBoundary>
        </StartDealProvider>
        <Toaster />
        <KeyboardInset />
        {/* F88: undoes a `pointer-events: none` that Stripe.js's modal backdrop restores
            after a Radix dialog has released its lock. Renders nothing. */}
        <BodyPointerGuard />
        {/* Behavioural instrumentation (0121). Renders nothing, records a PAGE_VIEW per
            navigation for signed-in members only — `recordUxEvent` drops guests, and
            0121's header records why an `anon` write path is not wanted. Mounted here
            rather than per route group so a funnel cannot have a hole where someone
            forgot to add it. */}
        <PageViewTracker />
        {/* Vercel Web Analytics + Speed Insights. Cookieless and anonymous, so unlike
            PageViewTracker they count GUESTS too — the catalog is open to them and
            that is where acquisition happens. Both are no-ops off Vercel. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
