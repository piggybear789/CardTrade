'use client';

// components/layout/SiteMenu.tsx
//
// Overflow menu for the site header. It lists the FULL workspace map, so every
// section is reachable from the burger on any viewport — the desktop rail is
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
import { SignInLink } from '@/components/layout/SignInLink';
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

/**
 * Destinations the SITE HEADER already carries, so the menu does not repeat them.
 *
 * The bell has always been Notifications and the avatar has always been Account, so
 * two of the menu's rows were restating the bar above them. Saved and Messages are
 * now icons up there too. All four rows are therefore hidden from `sm` up — the
 * breakpoint at which those header controls appear — and kept below it, because the
 * two new icons are `hidden sm:inline-flex` and removing the rows outright would
 * make Saved unreachable on a phone.
 *
 * NOT removed from `MARKETPLACE_NAV_GROUPS`: that constant also drives the desktop
 * rail, which is a workspace sidebar that SHOULD list Messages and Account, and the
 * mobile hubs read it by index. Skipping rows is this menu's business, so the
 * decision lives here rather than in the shared map.
 */
const PROMOTED_TO_HEADER: readonly string[] = [
  '/saved',
  '/messages',
  '/notifications',
  '/profile',
];

/** True when every link in a group is already in the header. */
function groupIsFullyPromoted(group: MarketplaceNavGroup): boolean {
  return group.links.every((link) => PROMOTED_TO_HEADER.includes(link.href));
}

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
   * already assigns those paths to a section — `/listings/new` belongs to My
   * Listings, `/profile/payouts` to Account. Highlighting them here as well would
   * put two rows in the menu each claiming to be the current page.
   */
  function renderLink(link: MarketplaceNavLink, trackCurrent = true) {
    const active = trackCurrent && isMarketplaceSectionActive(pathname, link.href);
    // A row the header already carries stays reachable on a phone and disappears
    // from `sm` up, where the icon for it exists.
    const promoted = PROMOTED_TO_HEADER.includes(link.href);
    return (
      <Button
        key={link.href}
        asChild
        variant="ghost"
        className={cn(
          'justify-start',
          promoted && 'sm:hidden',
          active && 'bg-accent text-accent-foreground',
        )}
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
            <HeaderSearch ariaLabel="Search listings from menu" />
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
                  <SignInLink>Sign in</SignInLink>
                </Button>
                <Button asChild className="justify-start">
                  <SignInLink target="/sign-up">Get started</SignInLink>
                </Button>
              </>
            ) : (
              <>
                {MARKETPLACE_NAV_GROUPS.map((group, index) => {
                  // The "You" group is entirely in the header now, so its heading and
                  // rule have to go with its rows — otherwise `sm` and up shows a
                  // "YOU" label with nothing under it.
                  const fullyPromoted = groupIsFullyPromoted(group);
                  return (
                    <Fragment key={group.label}>
                      {index > 0 ? (
                        <div className={cn('my-1 border-t', fullyPromoted && 'sm:hidden')} />
                      ) : null}
                      <p
                        className={cn(
                          'market-label px-3 pb-1 pt-2 text-muted-foreground',
                          fullyPromoted && 'sm:hidden',
                        )}
                      >
                        {group.label}
                      </p>
                      {group.links.map((link) => renderLink(link))}
                    </Fragment>
                  );
                })}

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
