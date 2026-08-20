// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. The only client
// island is the sign-out control (see SignOutButton).

import Link from 'next/link';
import { BookmarkCheck, MessageCircle } from 'lucide-react';

import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Logo } from '@/components/layout/Logo';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { RegionIndicator } from '@/components/layout/RegionIndicator';
import { SignInLink } from '@/components/layout/SignInLink';
import { SiteMenu } from '@/components/layout/SiteMenu';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import {
  resolveBrowseRegion,
  type ResolvedRegion,
} from '@/lib/location/resolveRegion';
import { normalizeRegionCode } from '@/domain/region';

export async function SiteHeader() {
  const user = await getCachedAuthUser();
  const isAuthenticated = Boolean(user);

  // Seed the notification bell with a server-fetched snapshot so it is populated
  // on first paint, before the realtime channel opens.
  const initialNotifications = isAuthenticated
    ? (await listMyNotifications())
    : null;

  let region: ResolvedRegion;
  let isAdmin = false;
  let isStaff = false;
  let displayName: string | null = null;
  let avatarPath: string | null = null;
  if (user) {
    const profile = await getCachedProfile(user.id);
    isAdmin = Boolean(profile?.is_admin);
    isStaff = isAdmin || Boolean(profile?.is_support);
    displayName = profile?.display_name?.trim() || null;
    avatarPath = (profile?.avatar_path as string | null) ?? null;

    const own = normalizeRegionCode(profile?.region_code);
    region = own
      ? { code: own, source: 'profile' }
      : await resolveBrowseRegion();
  } else {
    region = await resolveBrowseRegion();
  }

  // The top bar stays transactional: browse, sell, deal, plus the caller's name
  // as a profile shortcut. Everything else (purchases, sales, messages, admin,
  // sign-out) lives behind the burger menu.
  return (
    <header
      style={{ viewTransitionName: 'site-header' }}
      className="market-header relative sticky top-0 z-40 border-b border-white/15 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold/65 after:to-transparent"
    >
      <div className="flex h-16 w-full items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
        {/* Logo keeps intrinsic width on mobile so equal flex-1 columns cannot
            shrink the wordmark out of view. */}
        <div className="flex min-w-0 shrink-0 items-center gap-3 sm:min-w-0 sm:flex-1">
          {/* The wordmark doubles as the route home, which is what users expect
              of a site logo. */}
          <Link
            href="/"
            aria-label="NoDitto home"
            className="min-w-0 rounded-md text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Logo />
          </Link>
          {/* Client island: needs `usePathname` to mark the current section, which
              a Server Component cannot read. See PrimaryNav. */}
          <PrimaryNav isAuthenticated={isAuthenticated} />
        </div>

        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-2">
          <HeaderSearch className="market-search" />
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 text-parchment sm:flex-1 sm:gap-2">
          <RegionIndicator regionCode={region.code} source={region.source} />
          {isAuthenticated && user ? (
            <>
              {/* PROMOTED OUT OF THE BURGER, as icons. The overflow menu had grown to
                  six labelled groups, and two of its rows — Notifications and Account
                  — were already in this bar as the bell and the avatar, so the menu
                  was restating the header rather than extending it. Saved and Messages
                  are the two highest-frequency destinations that were menu-only, so
                  they come up here and the corresponding rows drop out of the menu at
                  the same breakpoint.

                  `hidden sm:inline-flex`, not always-on: below `sm` this bar is
                  already carrying the wordmark, the region, the bell, a truncated
                  display name and the burger, and two more icons crowd it. Below `sm`
                  these stay in the menu instead — see PROMOTED_HREFS in SiteMenu,
                  which hides exactly these rows from `sm` up, so neither viewport gets
                  a dead end and neither gets the row twice.

                  Icon-only needs the accessible name spelled out: the glyph is the
                  whole control, so `aria-label` is the only name it has, and `title`
                  gives sighted users the same word on hover. */}
              <Link
                href="/saved"
                aria-label="Saved listings"
                title="Saved"
                className="hidden size-10 touch-manipulation items-center justify-center rounded-md text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian sm:inline-flex"
              >
                <BookmarkCheck className="size-5" aria-hidden />
              </Link>
              <Link
                href="/messages"
                aria-label="Messages"
                title="Messages"
                className="hidden size-10 touch-manipulation items-center justify-center rounded-md text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian sm:inline-flex"
              >
                <MessageCircle className="size-5" aria-hidden />
              </Link>
              <NotificationBell
                userId={user.id}
                initialNotifications={
                  initialNotifications?.ok ? initialNotifications.notifications : []
                }
              />
              <Button asChild variant="ghost" size="sm" className="min-w-0 max-w-[9rem] overflow-hidden sm:max-w-[14rem]">
                <Link
                  href="/profile"
                  /* No font override: the Button already supplies the header's
                     `text-sm font-semibold`. This carried `font-medium`, which
                     quietly stepped the name down a weight from the nav links
                     sitting a few pixels away. */
                  className="flex min-w-0 items-center gap-2"
                  aria-label={displayName ?? 'Your profile'}
                  title={displayName ?? 'Your profile'}
                >
                  {/* Own avatar as the profile shortcut — the conventional place a
                      member looks for their own account. */}
                  <Avatar
                    avatarPath={avatarPath}
                    displayName={displayName}
                    size="xs"
                    className="border-white/25"
                  />
                  <span className="hidden min-w-0 truncate sm:inline">{displayName ?? 'Profile'}</span>
                </Link>
              </Button>
            </>
          ) : (
            <nav aria-label="Account" className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <SignInLink>Sign in</SignInLink>
              </Button>
              <Button
                asChild
                size="sm"
                className="border-parchment/20 bg-parchment text-obsidian hover:bg-parchment/90"
              >
                <SignInLink target="/sign-up">
                  <span className="hidden sm:inline">Get started</span>
                  <span className="sm:hidden">Sign up</span>
                </SignInLink>
              </Button>
            </nav>
          )}

          <SiteMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} isStaff={isStaff} />
        </div>
      </div>
    </header>
  );
}

export function SiteHeaderSkeleton() {
  return (
    <header
      style={{ viewTransitionName: 'site-header' }}
      className="market-header relative sticky top-0 z-40 border-b border-white/15 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold/65 after:to-transparent"
    >
      <div className="flex h-16 w-full items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
        <div className="flex min-w-0 shrink-0 items-center gap-3 sm:min-w-0 sm:flex-1">
          <Link
            href="/"
            aria-label="NoDitto home"
            className="min-w-0 rounded-md text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Logo />
          </Link>
          <div className="hidden h-8 w-24 animate-pulse rounded bg-white/10 sm:block" />
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-2">
          <div className="h-9 w-full max-w-sm animate-pulse rounded-md bg-white/10" />
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 sm:flex-1 sm:gap-2">
          <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
          <div className="size-8 animate-pulse rounded-full bg-white/10" />
        </div>
      </div>
    </header>
  );
}
