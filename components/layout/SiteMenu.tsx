'use client';

// components/layout/SiteMenu.tsx
//
// Overflow menu for the site header. It lists the FULL workspace map, so every
// section is reachable from the burger on any viewport â€” the desktop rail is
// hidden on narrow screens and the mobile hubs only surface five destinations,
// which left several tabs with no route in from here.
//
// The groups are read from `marketplace-nav-config` rather than restated, so the
// menu cannot drift from the rail and the mobile hubs the way a second hardcoded
// list would. Closes on outside click, Escape, and every route change.

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote, Menu, PackagePlus, Repeat2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { SignOutButton } from '@/components/layout/SignOutButton';
import {
  MARKETPLACE_NAV_GROUPS,
  STAFF_NAV_GROUP,
  isMarketplaceSectionActive,
  staffNavLinksFor,
  type MarketplaceNavGroup,
  type MarketplaceNavLink,
} from '@/components/layout/marketplace-nav-config';
import { cn } from '@/lib/utils';

/**
 * Destinations the section map deliberately omits, listed here so the burger can
 * still reach them.
 *
 * They are not added to `MARKETPLACE_NAV_GROUPS` on purpose: that constant drives
 * the desktop rail and the mobile hub sheets, and the hubs read it BY INDEX, so
 * growing it would repoint the Contracts and Sell sheets. These rows are also the
 * only way in on a phone, where `PrimaryNav` (which carries Sell) is `lg:` only.
 */
const MENU_ONLY_GROUPS: readonly MarketplaceNavGroup[] = [
  {
    label: 'Create',
    links: [
      { href: '/listings/new', label: 'Sell an item', icon: PackagePlus },
      { href: '/trades/new', label: 'Propose a trade', icon: Repeat2 },
    ],
  },
  {
    label: 'Money',
    links: [{ href: '/profile/payouts', label: 'Payouts', icon: Banknote }],
  },
];

export interface SiteMenuProps {
  isAuthenticated: boolean;
  /** May moderate: shows the Admin console link. */
  isAdmin: boolean;
  /**
   * May arbitrate: shows the Arbitration link. True for admins too.
   *
   * Separate from `isAdmin` because a support worker has the first capability and not
   * the second, and deriving one from the other is how the two questions would drift
   * into one wrong answer.
   */
  isStaff?: boolean;
}

export function SiteMenu({ isAuthenticated, isAdmin, isStaff = false }: SiteMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staffLinks = staffNavLinksFor({ isStaff, isAdmin });

  /**
   * One row per destination, marking the current section.
   *
   * `aria-current` and the visible highlight ship together: the semantic
   * attribute on its own would tell assistive tech a position sighted users
   * cannot see, which is the same half-fix `PrimaryNav` calls out.
   *
   * `trackCurrent` is off for {@link MENU_ONLY_GROUPS} because the section map
   * already assigns those paths to a section â€” `/listings/new` belongs to My
   * Listings, `/profile/payouts` to Account. Highlighting them here as well would
   * put two rows in the menu each claiming to be the current page.
   */
  function renderLink(link: MarketplaceNavLink, trackCurrent = true) {
    const active = trackCurrent && isMarketplaceSectionActive(pathname, link.href);
    return (
      <Button
        key={link.href}
        asChild
        variant="ghost"
        className={cn('justify-start', active && 'bg-accent text-accent-foreground')}
      >
        <Link href={link.href} aria-current={active ? 'page' : undefined}>
          <link.icon aria-hidden />
          {link.label}
        </Link>
      </Button>
    );
  }

  // Never leave the menu hanging open after a navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;

    // `pointerdown` covers touch and pen as well as mouse.
    function onPointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', !isAuthenticated && 'lg:hidden')}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex size-10 touch-manipulation items-center justify-center rounded-md hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {open ? (
          <X className="size-5" aria-hidden />
        ) : (
          <Menu className="size-5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          id="site-menu-panel"
          className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(18rem,calc(100vw-2rem))] origin-top-right overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-auction animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
        >
          <div className="p-1 sm:hidden">
            <HeaderSearch />
          </div>

          <nav aria-label="Menu" className="grid gap-1">
            {!isAuthenticated ? (
              <>
                <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                  Browse
                </p>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings">Marketplace</Link>
                </Button>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings/new">Sell an item</Link>
                </Button>
                <div className="my-1 border-t" />
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild className="justify-start">
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            ) : (
              <>
                {MARKETPLACE_NAV_GROUPS.map((group, index) => (
                  <Fragment key={group.label}>
                    {index > 0 ? <div className="my-1 border-t" /> : null}
                    <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                      {group.label}
                    </p>
                    {group.links.map((link) => renderLink(link))}
                  </Fragment>
                ))}

                {MENU_ONLY_GROUPS.map((group) => (
                  <Fragment key={group.label}>
                    <div className="my-1 border-t" />
                    <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                      {group.label}
                    </p>
                    {group.links.map((link) => renderLink(link, false))}
                  </Fragment>
                ))}

                {staffLinks.length > 0 ? (
                  <>
                    <div className="my-1 border-t" />
                    <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                      {STAFF_NAV_GROUP.label}
                    </p>
                    {staffLinks.map((link) => renderLink(link))}
                  </>
                ) : null}

                <div className="my-1 border-t" />
                <SignOutButton className="w-full justify-start" />
              </>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
