import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { StartDealProvider } from '@/components/deals/StartDealProvider';
import { KeyboardInset } from '@/components/layout/KeyboardInset';
import { SiteHeader, SiteHeaderSkeleton } from '@/components/layout/SiteHeader';
import { MotionProvider } from '@/components/providers/MotionProvider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// ONE TYPEFACE. Plus Jakarta Sans for everything — headings, body, eyebrow labels
// and ledger figures alike. Geist Mono was previously loaded for labels and money,
// which meant two families on any surface pairing a label with a sentence. Column
// alignment for money is preserved by `tabular-nums` in `.display-value`, a font
// FEATURE that does not need a second family. Nothing references `font-mono` now,
// so loading it was a download for no rendered glyphs.
// `swap`, AND STATED EXPLICITLY even though it is `next/font/google`'s default, because
// this line has been changed in both directions and the next person deserves the reason
// rather than an absent option.
//
// IT WAS `optional`, AND `optional` IS WHY THE BRAND FACE DID NOT RENDER. That value
// gives the font a ~100ms block window and then COMMITS for the rest of the page load:
// if the file did not arrive inside the window, the fallback is kept and nothing swaps,
// however early the font lands afterwards. The bet was that a root-layout preload wins
// 100ms often enough that most visits still get Plus Jakarta.
//
// It does not. A dev server compiling on demand loses that window nearly every time, so
// the app renders in the system face on every cold load and the design is only ever seen
// by accident — which is the bug this reverses, reported as "the fonts don't load on
// desktop". Production is better but not reliable, and a typeface that appears at random
// is worse than one that appears late.
//
// WHAT `optional` WAS BUYING, and why losing it is affordable. `swap` paints the
// fallback and replaces it whenever the webfont arrives, so the replacement can land
// after first paint. `adjustFontFallback` stays on (the default): Next synthesises a
// metric-matched local fallback with `size-adjust` and matching metric overrides, so the
// fallback occupies the same space Plus Jakarta will. The swap therefore changes glyph
// SHAPES and not line boxes, which is a repaint rather than the reflow the previous
// comment was avoiding.
//
// If the swap ever needs to be tighter than that, the lever is `preload` and the subset,
// not `display` — starving the page of its typeface is not a performance win.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app';

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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NoDitto',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Phone chrome is the page surface; desktop keeps the obsidian header.
  // Both are the literal `--obsidian` / `--background` values.
  themeColor: [
    { media: '(min-width: 768px)', color: '#120f15' },
    { media: '(max-width: 767px)', color: '#fbf8fc' },
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
  return store
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const maybeSignedIn = await hasSessionCookie();

  return (
    <html
      lang="en"
      className={plusJakarta.variable}
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
          className="fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100] -translate-y-24 rounded-md bg-iris px-4 py-2 text-body font-semibold text-obsidian shadow-auction transition-transform hover:bg-iris/90 border border-transparent focus:outline-none focus-visible:translate-y-0 focus-visible:border-mist"
        >
          Skip to Main Content
        </a>
        <MotionProvider>
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
        </MotionProvider>
      </body>
    </html>
  );
}
