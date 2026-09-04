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

import { StartDealButton } from '@/components/deals/StartDealButton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
  /**
   * How to decide "you are here".
   *
   * `exact` exists because `/listings/new` sits under a tree that Marketplace
   * also claims: a plain `startsWith` would light up Marketplace while you are
   * on the Sell form, so the two links would both claim to be current.
   */
  match: 'exact' | 'prefix';
  /**
   * Trees that belong to this link but do not sit under its `href`.
   *
   * Marketplace needs this because the catalog is served from `/` while listing
   * detail pages stayed at `/listings/[id]`. Prefix matching on `/` cannot reach
   * them — and would claim every route in the app if it could.
   */
  alsoPrefix?: string[];
  /** Sub-paths that belong to a different link and must not match this one. */
  except?: string[];
}

function isActive(pathname: string, link: NavLink): boolean {
  // `except` is checked first so a more specific link can veto a broader one
  // regardless of which clause would otherwise match.
  if (link.except?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return false;
  }
  if (
    link.alsoPrefix?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return true;
  }
  if (link.match === 'exact') return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

export function PrimaryNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const pathname = usePathname();

  const links: NavLink[] = [
    {
      href: '/',
      label: 'Marketplace',
      match: 'exact',
      alsoPrefix: ['/listings'],
      except: ['/listings/new'],
    },
    { href: '/listings/new', label: 'Sell', match: 'exact' },
    // Private-deal compose is a dialog. Trades still lists open rooms
    // and unused trade invites.
    ...(isAuthenticated
      ? [{ href: '/trades', label: 'Trades', match: 'prefix' as const }]
      : []),
  ];

  return (
    <nav aria-label="Primary" className="hidden items-center text-mist md:flex">
      {links.map((link) => {
        const active = isActive(pathname, link);
        return (
          <Button
            key={link.href}
            asChild
            variant="ghost"
            size="sm"
            className={cn(
              // The iris underline matches the header's own bottom-border accent,
              // so "current" is spoken in a language the bar already uses.
              'relative',
              active &&
                'text-mist after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-iris',
            )}
          >
            <Link href={link.href} aria-current={active ? 'page' : undefined}>
              {link.label}
            </Link>
          </Button>
        );
      })}
      <StartDealButton
        isAuthenticated={isAuthenticated}
        variant="ghost"
        size="sm"
        className="relative"
      />
    </nav>
  );
}
