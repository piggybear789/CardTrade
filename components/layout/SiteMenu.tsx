'use client';

// components/layout/SiteMenu.tsx
//
// Overflow menu for the site header. A signed-in member opens it from their avatar
// chip; a guest, who has no avatar, from a burger.
//
// THE SIGNED-IN MENU IS SHORT ON PURPOSE. It used to restate the whole workspace map,
// fifteen-odd rows in six groups mirroring the rail beside it, so finding Sign out
// meant reading past every section. It now holds what belongs to the account rather
// than to the workspace: who you are and how others see you, money, settings,
// support, sign out. Sections live in the rail and the header nav.
//
// Desktop only for a signed-in member: on a phone the hub bar owns navigation. Guests
// keep the burger on a phone, since they have no hubs. Closes on outside click,
// Escape, and every route change.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, BanknoteIcon, HelpCircleIcon, MenuIcon, Settings01Icon, ShieldCheckIcon, XIcon } from '@hugeicons/core-free-icons';

import { StartDealButton } from '@/components/deals/StartDealButton';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SignInLink } from '@/components/layout/SignInLink';
import { SignOutButton } from '@/components/layout/SignOutButton';
import {
  STAFF_NAV_GROUP,
  isMarketplaceSectionActive,
  staffNavLinksFor,
  type MarketplaceNavLink,
} from '@/components/layout/marketplace-nav-config';
import { cn } from '@/lib/utils';

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
  /** The member's id, for "View public profile" (`/sellers/[id]`). */
  userId?: string | null;
}

export function SiteMenu({
  isAuthenticated,
  isAdmin,
  isStaff = false,
  displayName = null,
  avatarPath = null,
  email = null,
  userId = null,
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
   */
  function renderLink(link: MarketplaceNavLink) {
    const active = isMarketplaceSectionActive(pathname, link.href);
    return (
      <Button
        key={link.href}
        asChild
        variant="ghost"
        size="sm"
        className={cn('!h-9 justify-start', active && 'bg-accent text-accent-foreground')}
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
      {isAuthenticated ? (
        // THE AVATAR CHIP IS THE TRIGGER, and `aria-expanded` carries open and
        // closed. Its accessible name leads with the member's name, which the
        // chip itself no longer prints.
        //
        // AVATAR AND CHEVRON ONLY. A display name may run to 255 characters, so
        // beside the avatar it was cut to "Alice Nguy…" at most widths and took
        // its room from the search. The panel this opens states the account in
        // full on its first row, which is where the answer to "which account am
        // I in?" belongs. 40px tall, matching the icon targets beside it.
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="site-menu-panel"
          aria-label={`${displayName ?? 'Your account'}, account menu`}
          title={displayName ?? undefined}
          className={cn(
            'flex h-10 shrink-0 touch-manipulation items-center gap-tight rounded-md border border-transparent pl-tight pr-snug text-mist transition-colors hover:bg-white/10 focus:outline-none focus-visible:border-iris',
            open && 'bg-white/10',
          )}
        >
          <Avatar
            avatarPath={avatarPath}
            displayName={displayName}
            size="sm"
            className="border-white/25"
          />
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              'size-4 shrink-0 text-mist/75 transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      ) : (
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
      )}

      {open ? (
        <div
          id="site-menu-panel"
          className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(18rem,calc(100vw-2rem))] origin-top-right overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-auction animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 motion-reduce:animate-none"
        >
          <nav aria-label="Menu" className="grid gap-0.5">
            {!isAuthenticated ? (
              <>
                <p className="market-label px-2.5 pb-0 pt-tight text-muted-foreground">
                  Browse
                </p>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/">Marketplace</Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/listings/new">Sell an item</Link>
                </Button>
                <StartDealButton
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
                {/* WHO YOU ARE, and how others see you. The chip that opens this has
                    room for an avatar only, so this is the one place the header states
                    the account in full — the email answers "which account am I in?",
                    which a display name shared by several members cannot. The row is
                    the public profile link, because that is the question a name raises. */}
                <div className="flex items-center gap-2.5 px-2.5 py-snug">
                  <Avatar avatarPath={avatarPath} displayName={displayName} size="sm" />
                  <span className="grid min-w-0">
                    <span className="truncate text-body font-medium">
                      {displayName ?? 'Your account'}
                    </span>
                    {email ? (
                      <span className="truncate text-meta text-muted-foreground">{email}</span>
                    ) : null}
                    {userId ? (
                      <Link
                        href={`/sellers/${userId}`}
                        className="justify-self-start text-meta font-medium text-iris-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                      >
                        View public profile
                      </Link>
                    ) : null}
                  </span>
                </div>
                <div className="my-0.5 border-t" />

                {renderLink({ href: '/profile/payouts', label: 'Payouts', icon: BanknoteIcon })}
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className={cn('!h-9 justify-start', accountActive && 'bg-accent text-accent-foreground')}
                >
                  <Link href="/profile" aria-current={accountActive ? 'page' : undefined}>
                    <HugeiconsIcon icon={Settings01Icon} aria-hidden />
                    Account settings
                  </Link>
                </Button>

                {staffLinks.length > 0 ? (
                  <>
                    <div className="my-0.5 border-t" />
                    <p className="market-label px-2.5 pb-0 pt-tight text-muted-foreground">
                      {STAFF_NAV_GROUP.label}
                    </p>
                    {staffLinks.map((link) => renderLink(link))}
                  </>
                ) : null}

                {/* A DIALOG, NOT A DESTINATION, so it is placed by hand rather than
                    added to the nav map — the same reason `StartDealButton` is. `onOpen`
                    closes this panel, otherwise it stays open behind the dialog and is
                    the first thing the member sees again when they finish. */}
                <div className="my-0.5 border-t" />
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/help">
                    <HugeiconsIcon icon={HelpCircleIcon} aria-hidden />
                    Help
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="!h-9 justify-start">
                  <Link href="/safety">
                    <HugeiconsIcon icon={ShieldCheckIcon} aria-hidden />
                    Staying safe
                  </Link>
                </Button>
                <FeedbackDialog appearance="menu-row" onOpen={() => setOpen(false)} />

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
