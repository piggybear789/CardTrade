// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. Client islands:
// search, guest CTAs, primary nav, the bell, and the burger.

import Link from 'next/link';
import { BookmarkCheck, MessageCircle } from 'lucide-react';

import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Logo } from '@/components/layout/Logo';
import { GuestHeaderCtas } from '@/components/layout/GuestHeaderCtas';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { MobileHeaderSearch } from '@/components/layout/MobileHeaderSearch';
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

  // The top bar stays transactional: browse, sell, deal, plus the caller's name
  // as a profile shortcut. Everything else (purchases, sales, messages, admin,
  // sign-out) lives behind the burger menu.
  return (
    <header
      style={{ viewTransitionName: 'site-header' }}
      className="market-header relative sticky top-0 z-40 border-b border-white/15 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold/65 after:to-transparent"
    >
      <div className="flex h-16 w-full items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
        <div className="flex min-w-0 shrink-0 items-center gap-3 md:min-w-0 md:flex-1">
          <Link
            href="/"
            aria-label="NoDitto home"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent text-parchment focus:outline-none focus-visible:border-gold"
          >
            <Logo />
          </Link>
          <PrimaryNav isAuthenticated={isAuthenticated} />
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
          <HeaderSearch className="market-search" />
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-parchment md:flex-1 md:gap-2">
          <MobileHeaderSearch />
          <RegionIndicator regionCode={region.code} source={region.source} />
          {isAuthenticated && user ? (
            <>
              {/* Saved / Messages sit in the bar from `md` up. Below that the
                  hubs and burger already reach them — promoting at `sm` crowded
                  a 640px bar that still hid PrimaryNav. */}
              <Link
                href="/saved"
                aria-label="Saved listings"
                title="Saved"
                className="hidden size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:border-gold md:inline-flex"
              >
                <BookmarkCheck className="size-5" aria-hidden />
              </Link>
              <Link
                href="/messages"
                aria-label="Messages"
                title="Messages"
                className="hidden size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:border-gold md:inline-flex"
              >
                <MessageCircle className="size-5" aria-hidden />
              </Link>
              <NotificationBell
                userId={user.id}
                initialNotifications={
                  initialNotifications?.ok ? initialNotifications.notifications : []
                }
              />
              <Button asChild variant="ghost" size="sm" className="hidden min-w-0 max-w-[9rem] overflow-hidden md:inline-flex md:max-w-[14rem]">
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
        <div className="flex min-w-0 shrink-0 items-center gap-3 md:min-w-0 md:flex-1">
          <Link
            href="/"
            aria-label="NoDitto home"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-parchment border border-transparent focus:outline-none focus-visible:border-gold"
          >
            <Logo />
          </Link>
          <div className="hidden h-8 w-24 animate-pulse rounded bg-white/10 md:block" />
        </div>
        <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
          <div className="h-9 w-full max-w-sm animate-pulse rounded-md bg-white/10" />
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 md:flex-1 md:gap-2">
          <div className="size-11 animate-pulse rounded-md bg-white/10 md:hidden" />
          <div className="hidden h-8 w-16 animate-pulse rounded bg-white/10 md:block" />
          <div className="size-8 animate-pulse rounded-full bg-white/10" />
        </div>
      </div>
    </header>
  );
}
