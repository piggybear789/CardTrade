import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';

import { StartDealProvider } from '@/components/deals/StartDealProvider';
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
  title: 'NoDitto — Know who is on the other side',
  description:
    'Buy, sell, and swap high-value collectibles with identity verification, collateral-backed contracts, and payments by Stripe.',
  applicationName: 'NoDitto',
  alternates: { canonical: '/' },
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
    title: 'NoDitto — Know who is on the other side',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NoDitto — Know who is on the other side',
    description:
      'Identity verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // The app ships a single light theme; the browser chrome colour matches the
  // obsidian header bar (and the manifest's theme_color) in both OS modes.
  themeColor: '#0c0b0a',
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
          className="fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100] -translate-y-24 rounded-md bg-gold px-4 py-2 text-body font-semibold text-obsidian shadow-auction transition-transform hover:bg-gold/90 border border-transparent focus:outline-none focus-visible:translate-y-0 focus-visible:border-parchment"
        >
          Skip to Main Content
        </a>
        <MotionProvider>
          <StartDealProvider>
            <Suspense fallback={<SiteHeaderSkeleton />}>
              <SiteHeader />
            </Suspense>
            <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col scroll-mt-[calc(4rem+1px+env(safe-area-inset-top))] focus:outline-none">
              {children}
            </div>
          </StartDealProvider>
          <Toaster />
        </MotionProvider>
        <Analytics />
      </body>
    </html>
  );
}
