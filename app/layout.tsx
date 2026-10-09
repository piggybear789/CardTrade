import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Inter, JetBrains_Mono, Merriweather } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { StartDealProvider } from '@/components/deals/StartDealProvider';
import { KeyboardInset } from '@/components/layout/KeyboardInset';
import { PageViewTracker } from '@/components/analytics/PageViewTracker';
import { SiteHeader, SiteHeaderSkeleton } from '@/components/layout/SiteHeader';
import { Toaster } from '@/components/ui/sonner';
import { DEFAULT_OG_IMAGE, SITE_URL as siteUrl } from '@/lib/seo/site';
import { hasSupabaseSessionCookie } from '@/lib/supabase/sessionCookie';
import './globals.css';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// TYPEFACES COME FROM THE THEME: Inter (sans), Merriweather (serif) and
// JetBrains Mono (mono), matching `--font-sans` / `--font-serif` / `--font-mono` in
// globals.css. `next/font` self-hosts each one under a hashed family name exposed as
// a CSS variable, which `tailwind.config.ts` puts ahead of the theme's stack.
//
// `display: 'swap'` stays explicit: `optional` once meant the brand face rarely
// rendered on a cold load. Serif and mono are not preloaded because nothing on the
// critical path uses them.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-merriweather',
  display: 'swap',
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
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
  // Phone chrome is the page surface; desktop keeps the obsidian header.
  // Both are the literal `--obsidian` / `--background` values.
  themeColor: [
    { media: '(min-width: 768px)', color: '#111118' },
    { media: '(max-width: 767px)', color: '#fbfbff' },
  ],
  colorScheme: 'light',
  // Draw under notches/home indicators so the sticky header can pad itself
  // with safe-area insets instead of leaving a hardware-coloured gap.
  viewportFit: 'cover',
  // When the virtual keyboard opens, shrink the layout viewport so fixed/sticky
  // elements reposition instead of being hidden behind the keyboard.
  interactiveWidget: 'resizes-content',
};

/**
 * Is there a session cookie on this request?
 *
 * PRESENTATIONAL ONLY. Cookie presence is not proof of a valid session — the
 * token may be expired or revoked, which is why `SiteHeader` still verifies it
 * with `getUser()`. This exists so the header placeholder can pick the same
 * phone chrome the verified header will, and it is passed nowhere else.
 */
async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();
  return hasSupabaseSessionCookie(store.getAll());
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const maybeSignedIn = await hasSessionCookie();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${merriweather.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" />
        <link rel="preconnect" href="https://images.scrydex.com" />
        {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
        ) : null}
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100] -translate-y-24 rounded-md bg-iris px-group py-snug text-body font-semibold text-obsidian shadow-auction transition-transform hover:bg-iris/90 border border-transparent focus:outline-none focus-visible:translate-y-0 focus-visible:border-mist"
        >
          Skip to Main Content
        </a>
        <StartDealProvider>
          <Suspense fallback={<SiteHeaderSkeleton isAuthenticated={maybeSignedIn} />}>
            <SiteHeader />
          </Suspense>
          <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col scroll-mt-[calc(3rem+env(safe-area-inset-top))] focus:outline-none md:scroll-mt-[calc(4rem+1px+env(safe-area-inset-top))]">
            {children}
          </div>
        </StartDealProvider>
        <Toaster />
        <KeyboardInset />
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
