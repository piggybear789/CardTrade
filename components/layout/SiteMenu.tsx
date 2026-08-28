'use client';

// components/layout/SiteMenu.tsx
//
// Overflow menu for the site header. On desktop it lists the FULL workspace
// map so every section is reachable from the burger. On a phone the signed-in
// hub bar already owns that map, so this menu hides there and stays for guests
// (who have no hubs) and for signed-in desktop.
//
// The groups are read from `marketplace-nav-config` rather than restated, so the
// menu cannot drift from the rail and the mobile hubs the way a second hardcoded
// list would. Closes on outside click, Escape, and every route change.

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { BanknoteIcon, HandshakeIcon, MenuIcon, RepeatIcon, XIcon } from '@hugeicons/core-free-icons';

import { StartDealButton } from '@/components/deals/StartDealButton';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
 * growing it would repoint the Contracts and Sell sheets. Private Deal is a
 * dialog, not a route — the Create group injects it above Propose a trade.
 */
const MENU_ONLY_GROUPS: readonly MarketplaceNavGroup[] = [
  {
    label: 'Create',
    links: [
      { href: '/trades/new', label: 'Propose a trade', icon: RepeatIcon },
    ],
  },
  {
    label: 'Money',
    links: [{ href: '/profile/payouts', label: 'Payouts', icon: BanknoteIcon }],
  },
];

/**
 * Destinations the SITE HEADER already carries, so the menu does not repeat them.
 *
 * The bell has always been Notifications and the avatar has always been Account, so
 * two of the menu's rows were restating the bar above them. Saved and Messages are
 * now icons up there too. All four rows are therefore hidden from `md` up — the
 * breakpoint at which this menu appears for a signed-in member. On a phone the
 * hubs and header icons cover them, and the menu itself is hidden.
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
  /** Signed-in member's name, for the profile header. */
  displayName?: string | null;
  /** Stored avatar object path, NOT a URL. See `Avatar`. */
  avatarPath?: string | null;
  /**
   * Secondary identity line. The menu is reachable from any page, so it has to
   * answer "which account am I in?" on its own — a display name alone does not,
   * because several members can share one and a member can change theirs.
   */
  email?: string | null;
}

export function SiteMenu({
  isAuthenticated,
  isAdmin,
  isStaff = false,
  displayName = null,
  avatarPath = null,
  email = null,
}: SiteMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staffLinks = staffNavLinksFor({ isStaff, isAdmin });
  const accountActive = isMarketplaceSectionActive(pathname, '/profile');

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
    // A row the header already carries is hidden from `md` up, where this
    // menu and those header icons both exist.
    const promoted = PROMOTED_TO_HEADER.includes(link.href);
    return (
      <Button
        key={link.href}
        asChild
        variant="ghost"
        size="sm"
        className={cn(
          '!h-9 justify-start',
          promoted && 'md:hidden',
          active && 'bg-accent text-accent-foreground',
        )}
      >
        <Link href={link.href} aria-current={active ? 'page' : undefined}>
          <HugeiconsIcon icon={link.icon} aria-hidden />
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
      className={cn(
        'relative',
        // Guests still need the burger on a phone (no hub bar). Signed-in
        // members reach the same map from the bottom hubs, so the header
        // copy of that list is desktop-only.
        isAuthenticated ? 'hidden md:block' : 'md:hidden',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex size-11 touch-manipulation items-center justify-center rounded-md border border-transparent hover:bg-white/10 focus:outline-none focus-visible:border-iris"
      >
        {open ? (
          <HugeiconsIcon icon={XIcon} className="size-5" aria-hidden />
        ) : (
          <HugeiconsIcon icon={MenuIcon} className="size-5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          id="site-menu-panel"
          className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(18rem,calc(100vw-2rem))] origin-top-right overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-auction animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 motion-reduce:animate-none"
        >
          <nav aria-label="Menu" className="grid gap-0.5">
            {!isAuthenticated ? (
              <>
                <p className="market-label px-2.5 pb-0 pt-1 text-muted-foreground">
                  Browse
                </p>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/">Marketplace</Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/listings/new">Sell an item</Link>
                </Button>
                <StartDealButton
                  isAuthenticated={false}
                  variant="ghost"
                  size="sm"
                  className="!h-9 justify-start"
                  onOpen={() => setOpen(false)}
                />
                <div className="my-0.5 border-t" />
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <SignInLink>Sign in</SignInLink>
                </Button>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <SignInLink target="/sign-up">Get started</SignInLink>
                </Button>
              </>
            ) : (
              <>
                {/* WHO YOU ARE, then where you can go. The menu opens from an
                    avatar chip that only has room for a first name, so this is
                    the one place the workspace states the account in full. It
                    is also the Account link, which is why the row is the same
                    ghost button as every other destination rather than an inert
                    block with a separate link under it. */}
                <Button
                  asChild
                  variant="ghost"
                  className={cn(
                    // `!h-auto`, not `h-auto`: the default size pins `md:h-7`, and
                    // for a signed-in member this panel only exists from `md` up, so
                    // an unprefixed height never got a turn. The row was a 28px box
                    // holding a 32px avatar over two lines of text — both spilled
                    // out of it, so the hover fill painted a band across the middle
                    // of the row instead of behind it. Same trap as the `!h-9` rows.
                    '!h-auto justify-start gap-2.5 px-2.5 py-2',
                    accountActive && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Link
                    href="/profile"
                    aria-current={accountActive ? 'page' : undefined}
                  >
                    <Avatar
                      avatarPath={avatarPath}
                      displayName={displayName}
                      size="sm"
                    />
                    <span className="grid min-w-0 text-left">
                      {/* No colour of its own. The ghost variant's hover and the
                          current-section state both set the row's text colour, and
                          a hardcoded `text-foreground` here swallowed them — this
                          was the one row in the panel whose label stayed black
                          while every other label went iris under the cursor. */}
                      <span className="truncate font-medium">
                        {displayName ?? 'Your profile'}
                      </span>
                      {email ? (
                        <span className="truncate text-meta font-normal text-muted-foreground">
                          {email}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </Button>
                <div className="my-0.5 border-t" />

                {MARKETPLACE_NAV_GROUPS.map((group, index) => {
                  // The "You" group is entirely in the header now, so its heading and
                  // rule have to go with its rows — otherwise `sm` and up shows a
                  // "YOU" label with nothing under it.
                  const fullyPromoted = groupIsFullyPromoted(group);
                  return (
                    <Fragment key={group.label}>
                      {index > 0 ? (
                        <div className={cn('my-0.5 border-t', fullyPromoted && 'md:hidden')} />
                      ) : null}
                      <p
                        className={cn(
                          'market-label px-2.5 pb-0 pt-1 text-muted-foreground',
                          fullyPromoted && 'md:hidden',
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
                    <div className="my-0.5 border-t" />
                    <p className="market-label px-2.5 pb-0 pt-1 text-muted-foreground">
                      {group.label}
                    </p>
                    {group.label === 'Create' ? (
                      <>
                        <StartDealButton
                          isAuthenticated
                          variant="ghost"
                          size="sm"
                          className="!h-9 justify-start"
                          onOpen={() => setOpen(false)}
                        >
                          <HugeiconsIcon icon={HandshakeIcon} aria-hidden />
                          Private Deal
                        </StartDealButton>
                        {group.links.map((link) => renderLink(link, false))}
                      </>
                    ) : (
                      group.links.map((link) => renderLink(link, false))
                    )}
                  </Fragment>
                ))}

                {staffLinks.length > 0 ? (
                  <>
                    <div className="my-0.5 border-t" />
                    <p className="market-label px-2.5 pb-0 pt-1 text-muted-foreground">
                      {STAFF_NAV_GROUP.label}
                    </p>
                    {staffLinks.map((link) => renderLink(link))}
                  </>
                ) : null}

                <div className="my-0.5 border-t" />
                {/* `!h-9` on every row in this panel, including this one: the
                    `sm` size collapses to 24px from `md` inside a media query,
                    which an unprefixed `h-9` cannot override. A 24px row in a
                    menu you point at is too small to hit comfortably. */}
                <SignOutButton className="!h-9 w-full justify-start" />
              </>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
