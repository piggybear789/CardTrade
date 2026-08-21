import type { ReactNode } from 'react';
import Link from 'next/link';

import { Logo } from '@/components/layout/Logo';

const FOOTER_LINKS = [
  { href: '/listings', label: 'Marketplace' },
  { href: '/trades', label: 'Trades' },
  { href: '/help#holds', label: 'How it works' },
  { href: '/help', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 lg:px-8">
          <Link
            href="/"
            className="rounded-sm text-foreground border border-transparent focus:outline-none focus-visible:border-gold/40"
          >
            <Logo />
          </Link>
          <Link
            href="/"
            className="text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Back to home
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mt-auto border-t border-border">
        <nav
          aria-label="Legal and help"
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-3 px-6 py-8 text-body lg:px-8"
        >
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
