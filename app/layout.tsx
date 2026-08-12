import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { GeistMono } from 'geist/font/mono';

import { SiteHeader } from '@/components/layout/SiteHeader';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import './globals.css';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Plus Jakarta Sans for headings and body — rounder, friendlier geometry than
// Geist while still professional. Geist Mono stays for labels and ledger data.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});
const geistMono = GeistMono;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Pages self-brand their titles as "<Section> · NoDitto", so this is only
  // the fallback for routes that don't set one — no title template, to avoid
  // double-suffixing those existing titles.
  title: 'NoDitto — Know who is on the other side',
  description:
    'Buy, sell, and swap high-value collectibles with DittoShield anti-impostor verification, collateral-backed contracts, and payments by Stripe.',
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
      'DittoShield verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NoDitto — Know who is on the other side',
    description:
      'DittoShield verification, collateral-backed contracts, and Stripe payments for high-value collectibles.',
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
      className={cn(plusJakarta.variable, geistMono.variable)}
    >
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100] -translate-y-24 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-obsidian shadow-auction transition-transform hover:bg-gold/90 focus:outline-none focus-visible:translate-y-0 focus-visible:ring-2 focus-visible:ring-parchment"
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
