import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/layout/SiteHeader';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'CardTrade',
  description:
    'A safety-first P2P clearinghouse and marketplace for collectibles.',
};

export const viewport: Viewport = {
  themeColor: '#0c0b0a',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
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
