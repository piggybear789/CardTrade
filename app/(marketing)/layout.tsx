import type { ReactNode } from 'react';
import Link from 'next/link';

const FOOTER_LINKS = [
  { href: '/', label: 'Marketplace' },
  { href: '/trades', label: 'Trades' },
  { href: '/help#holds', label: 'How it works' },
  { href: '/safety', label: 'Staying safe' },
  { href: '/help', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-1">{children}</div>
      <footer className="mt-auto border-t border-border">
        <nav
          aria-label="Legal and help"
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-cozy px-6 py-section text-body lg:px-section"
        >
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
