'use client';

// components/layout/MarketplaceNav.tsx
//
// Navigation for the shared marketplace workspace rail. Grouped so the sections
// that hold live money - purchases, sales, trades, deals - sit together and are
// each one click from anywhere, rather than nested behind an account tab.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookmarkCheck,
  HandCoins,
  Handshake,
  MessageCircle,
  Repeat2,
  ShoppingBag,
  Sparkles,
  Tag,
  Tags,
  UserRound,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Rail sections. `exact` marks a route whose subpaths belong to other sections
 * (e.g. /listings/mine and /listings/new are their own tasks, not browsing).
 */
const GROUPS = [
  {
    label: 'Marketplace',
    links: [
      { href: '/listings', label: 'Browse All', icon: Sparkles },
      { href: '/saved', label: 'Saved', icon: BookmarkCheck },
    ],
  },
  {
    label: 'Contracts',
    links: [
      { href: '/purchases', label: 'Purchases', icon: ShoppingBag },
      { href: '/sales', label: 'Sales', icon: Tag },
      { href: '/trades', label: 'Trades', icon: Repeat2 },
      { href: '/deals', label: 'Deals', icon: Handshake },
    ],
  },
  {
    label: 'Selling',
    links: [
      { href: '/listings/mine', label: 'My Listings', icon: Tags },
      { href: '/offers', label: 'Offers', icon: HandCoins },
    ],
  },
  {
    label: 'You',
    links: [
      { href: '/messages', label: 'Messages', icon: MessageCircle },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/profile', label: 'Account', icon: UserRound },
    ],
  },
] as const;

/** Returns true when `href` is the active marketplace section. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/listings') {
    // Browsing owns listing detail pages; selling, editing, and the caller's own
    // listings are separate sections and must not light up Browse All.
    if (
      pathname === '/listings/new' ||
      pathname === '/listings/mine' ||
      pathname.endsWith('/edit')
    ) {
      return false;
    }
    return pathname === '/listings' || pathname.startsWith('/listings/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MarketplaceNav({
  primaryExtras,
}: {
  /**
   * Controls belonging to the Marketplace group - the catalog filters. Rendered
   * directly beneath it so the section and the thing that narrows it stay
   * together, instead of the filters sitting below every other section.
   */
  primaryExtras?: ReactNode;
} = {}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Marketplace sections" className="flex flex-col gap-4 lg:gap-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="market-label hidden px-3 pb-1.5 text-muted-foreground lg:block">
            {group.label}
          </p>
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
            {group.links.map((link) => {
              const active = isActive(pathname, link.href);
              const Icon = link.icon;
              return (
                <li key={link.href} className="shrink-0 lg:w-full">
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:gap-3',
                      active
                        ? 'bg-gold/10 font-semibold text-foreground'
                        : 'font-medium text-foreground/85 hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-gold' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Filters sit with the section they narrow. Rendered once, here, so
              the panel's ids stay unique at every breakpoint. */}
          {primaryExtras && group.label === 'Marketplace' ? primaryExtras : null}
        </div>
      ))}
    </nav>
  );
}
