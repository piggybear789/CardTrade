'use client';

// app/(marketing)/marketing-footer.tsx
//
// The help-and-legal link band under every page in the `(marketing)` group.
//
// HIDDEN ON PHONES FOR THE REFERENCES PAGES ONLY. `/references` and a person's
// references page are app screens, not prose: on a phone the band was two rows of links
// under a search or a profile, the bottom third of the screen spent on Terms and
// Privacy. Help, Terms, Privacy and Safety keep it at every width, because there it is
// how a reader moves between the documents; the hub bar under them links to none of
// them.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const FOOTER_LINKS = [
  { href: '/', label: 'Marketplace' },
  { href: '/trades', label: 'Trades' },
  { href: '/help#holds', label: 'How it works' },
  { href: '/safety', label: 'Staying safe' },
  { href: '/help', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

function isReferencesRoute(pathname: string): boolean {
  return pathname === '/references' || pathname.startsWith('/references/');
}

export function MarketingFooter() {
  const pathname = usePathname();
  return (
    // PHONE: tighter. The links are already 44px tall each, so a 12px row gap and 32px
    // of padding above and below made two rows of links a ~165px band.
    <footer
      className={cn('mt-auto border-t border-border/60', isReferencesRoute(pathname) && 'max-sm:hidden')}
    >
      <nav
        aria-label="Legal and help"
        className="mx-auto flex max-w-3xl flex-wrap gap-x-5 px-group py-snug text-body sm:gap-x-6 sm:gap-y-cozy sm:px-6 sm:py-section lg:px-section"
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
  );
}
