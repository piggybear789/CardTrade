import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, IBM_Plex_Mono, Inter } from 'next/font/google';

import { SiteHeader } from '@/components/layout/SiteHeader';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import './globals.css';

// Load the typefaces the design system already names (Inter for UI, an
// old-style serif for the display voice, a mono for ledger figures) so the
// brand renders identically across platforms instead of falling back to
// whatever serif each OS happens to ship.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'],
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cardtrade.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Pages self-brand their titles as "<Section> · Poke-xchange", so this is only
  // the fallback for routes that don't set one — no title template, to avoid
  // double-suffixing those existing titles.
  title: 'Poke-xchange — Protected Trades for Serious Collectors',
  description:
    'Buy, sell, and swap high-value collectibles with identity verification, live trade contracts, and collateral-backed escrow.',
  applicationName: 'Poke-xchange',
  keywords: [
    'collectibles',
    'trading cards',
    'escrow',
    'marketplace',
    'card trading',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Poke-xchange',
    title: 'Poke-xchange — Protected Trades for Serious Collectors',
    description:
      'Collateral-backed escrow and live trade contracts for high-value collectibles.',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Poke-xchange — Protected Trades for Serious Collectors',
    description:
      'Collateral-backed escrow and live trade contracts for high-value collectibles.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4efe4' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0b0a' },
  ],
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(inter.variable, fraunces.variable, plexMono.variable)}
    >
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="fixed left-4 top-3 z-[100] -translate-y-16 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-obsidian shadow-auction transition-transform hover:bg-gold/90 focus:outline-none focus-visible:translate-y-0 focus-visible:ring-2 focus-visible:ring-parchment"
        >
          Skip to Main Content
        </a>
        <SiteHeader />
        <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col focus:outline-none">
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
