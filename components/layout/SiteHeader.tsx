// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. Client islands:
// search, guest CTAs, primary nav, the bell, and the desktop burger.
//
// Phone chrome is a separate cream strip (`MobileTopChrome`). The dark
// marketplace header below is desktop-only (`md+`).

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookmarkCheck01Icon, MessageCircleIcon } from '@hugeicons/core-free-icons';

import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Logo } from '@/components/layout/Logo';
import { GuestHeaderCtas } from '@/components/layout/GuestHeaderCtas';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { MobileTopChrome } from '@/components/layout/MobileTopChrome';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { RegionIndicator } from '@/components/layout/RegionIndicator';
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

  // Sticky isolation wraps both chromes so view-transition-name stays unique.
  // The dark bar is `md+` only; the cream strip is phone-only.
  return (
    <div
      style={{ viewTransitionName: 'site-header' }}
      className="sticky top-0 z-40"
    >
      <header
        className="market-header relative hidden border-b border-white/15 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-iris/65 after:to-transparent md:block"
      >
        <div className="flex h-16 w-full items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          <div className="flex min-w-0 shrink-0 items-center gap-3 md:min-w-0 md:flex-1">
            <Link
              href="/"
              aria-label="NoDitto home"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent text-mist focus:outline-none focus-visible:border-iris"
            >
              <Logo />
            </Link>
            <PrimaryNav isAuthenticated={isAuthenticated} />
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
            <HeaderSearch className="market-search" />
          </div>

          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-mist md:flex-1 md:gap-2">
            <RegionIndicator regionCode={region.code} source={region.source} />
            {isAuthenticated && user ? (
              <>
                <Link
                  href="/saved"
                  aria-label="Saved listings"
                  title="Saved"
                  className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
                >
                  <HugeiconsIcon icon={BookmarkCheck01Icon} className="size-5" aria-hidden />
                </Link>
                <Link
                  href="/messages"
                  aria-label="Messages"
                  title="Messages"
                  className="hidden size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
                >
                  <HugeiconsIcon icon={MessageCircleIcon} className="size-5" aria-hidden />
                </Link>
                <NotificationBell
                  userId={user.id}
                  initialNotifications={
                    initialNotifications?.ok ? initialNotifications.notifications : []
                  }
                />
                {/* `!h-10` to match the 40px icon targets beside it. The `sm`
                    size collapses to 24px from `md`, which is the same height as
                    the 24px avatar inside it — the circle had no room and the
                    button's clip cropped it top and bottom into an ellipse.
                    Truncation of a long name is the inner span's `truncate`
                    job, so no `overflow-hidden` here to do the cropping. */}
                <Button asChild variant="ghost" size="sm" className="hidden !h-10 min-w-0 max-w-[9rem] px-2 md:inline-flex md:max-w-[14rem]">
                  <Link
                    href="/profile"
                    className="flex min-w-0 items-center gap-2"
                    aria-label={displayName ?? 'Your profile'}
                    title={displayName ?? 'Your profile'}
                  >
                    <Avatar
                      avatarPath={avatarPath}
                      displayName={displayName}
                      size="xs"
                      className="border-white/25"
                    />
                    <span className="hidden min-w-0 truncate md:inline">{displayName ?? 'Profile'}</span>
                  </Link>
                </Button>
              </>
            ) : (
              <GuestHeaderCtas />
            )}

            {user ? (
              <SiteMenu
                isAuthenticated
                isAdmin={isAdmin}
                isStaff={isStaff}
                displayName={displayName}
                avatarPath={avatarPath}
                email={user.email ?? null}
              />
            ) : null}
          </div>
        </div>
      </header>
      <MobileTopChrome isAuthenticated={isAuthenticated} />
    </div>
  );
}

/**
 * Loading chrome for the root layout's header boundary.
 *
 * THE PHONE STRIP IS REAL, NOT A PLACEHOLDER. This used to draw one hard-coded
 * shape — a full-width search pill and a filled circle — for all seven chrome
 * variants. `MobileTopChrome` picks by pathname, and the majority of the signed-in
 * app (every hub and every thread) resolves to `HubChrome`, which is a compact
 * frame with no row inside it at all. So the placeholder was 54px of bar that
 * collapsed to nothing the moment auth resolved, on `/messages`, `/trades`,
 * `/profile` and nine other routes: a full-width jump on first paint of most of
 * the app. On the routes that DO get a bar it was still the wrong bar — a back
 * chevron, a wordmark and a search pill are not interchangeable.
 *
 * The variant is a pure function of the pathname, which a client component reads
 * without waiting on anything, so the strip can simply render itself. Only
 * `isAuthenticated` needs the session, and it moves the geometry on just the
 * unlisted-route fallback — hence the presentational hint below.
 */
export function SiteHeaderSkeleton({
  /**
   * Cookie-derived guess, for placeholder geometry only — never for access.
   * It changes the rendered height on unlisted routes alone (`/help`, `/terms`,
   * `/privacy`), where a guest gets the marketing bar and a member gets none.
   */
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean;
}) {
  return (
    <div
      style={{ viewTransitionName: 'site-header' }}
      className="sticky top-0 z-40"
    >
      <header
        className="market-header relative hidden border-b border-white/15 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-iris/65 after:to-transparent md:block"
      >
        <div className="flex h-16 w-full items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          <div className="flex min-w-0 shrink-0 items-center gap-3 md:min-w-0 md:flex-1">
            <Link
              href="/"
              aria-label="NoDitto home"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-mist border border-transparent focus:outline-none focus-visible:border-iris"
            >
              <Logo />
            </Link>
            <div className="hidden h-8 w-24 animate-pulse rounded bg-white/10 md:block" />
          </div>
          <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
            <div className="h-9 w-full max-w-sm animate-pulse rounded-md bg-white/10" />
          </div>
          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 md:flex-1 md:gap-2">
            <div className="hidden h-8 w-16 animate-pulse rounded bg-white/10 md:block" />
            <div className="size-8 animate-pulse rounded-full bg-white/10" />
          </div>
        </div>
      </header>
      <MobileTopChrome isAuthenticated={isAuthenticated} />
    </div>
  );
}
