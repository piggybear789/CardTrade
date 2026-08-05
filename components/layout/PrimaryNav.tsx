'use client';

// components/layout/PrimaryNav.tsx
//
// The top bar's primary section links, split out as a client island for ONE
// reason: `SiteHeader` is a Server Component and cannot read the current path,
// so the nav had no way to say where you are. Three identical ghost buttons
// read as three equivalent offers rather than a position.
//
// The semantic attribute and the visible treatment ship together, deliberately.
// `aria-current="page"` with no visible style is half a fix — it tells assistive
// tech something sighted users cannot see.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
  /**
   * How to decide "you are here".
   *
   * `exact` exists because `/listings` is a PREFIX of `/listings/new`: a plain
   * `startsWith` would light up Marketplace while you are on the Sell form, so
   * the two links would both claim to be current. Marketplace still wants prefix
   * matching for `/listings/[id]`, so the exclusion is stated per link rather
   * than derived.
   */
  match: 'exact' | 'prefix';
  /** Sub-paths that belong to a different link and must not match this one. */
  except?: string[];
}

function isActive(pathname: string, link: NavLink): boolean {
  if (link.match === 'exact') return pathname === link.href;
  if (link.except?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return false;
  }
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

export function PrimaryNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const pathname = usePathname();

  const links: NavLink[] = [
    { href: '/listings', label: 'Marketplace', match: 'prefix', except: ['/listings/new'] },
    { href: '/listings/new', label: 'Sell', match: 'exact' },
    // Deals are withdrawn. A private deal was a Trade negotiated in its own room,
    // which is now what opening a trade offer does (Req 12).
    ...(isAuthenticated
      ? [{ href: '/trades', label: 'Trades', match: 'prefix' as const }]
      : []),
  ];

  return (
    <nav aria-label="Primary" className="hidden items-center text-parchment lg:flex">
      {links.map((link) => {
        const active = isActive(pathname, link);
        return (
          <Button
            key={link.href}
            asChild
            variant="ghost"
            size="sm"
            className={cn(
              // The gold underline matches the header's own bottom-border accent,
              // so "current" is spoken in a language the bar already uses.
              'relative',
              active &&
                'text-parchment after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-gold',
            )}
          >
            <Link href={link.href} aria-current={active ? 'page' : undefined}>
              {link.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
