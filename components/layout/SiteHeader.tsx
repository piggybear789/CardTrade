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

import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import { Skeleton } from '@/components/ui/skeleton';
import { GuestHeaderCtas } from '@/components/layout/GuestHeaderCtas';
import {
  HeaderAccountSlot,
  SignedInHeaderToolsPlaceholder,
} from '@/components/layout/HeaderAccountSlot';
import { Logo } from '@/components/layout/Logo';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { MobileTopChrome } from '@/components/layout/MobileTopChrome';
import { PrimaryNav } from '@/components/layout/PrimaryNav';

export async function SiteHeader() {
  const user = await getCachedAuthUser();
  const isAuthenticated = Boolean(user);

  // Seed the notification bell with a server-fetched snapshot so it is populated
  // on first paint, before the realtime channel opens.
  const initialNotifications = isAuthenticated
    ? (await listMyNotifications())
    : null;

  // No region control here: the catalog uses the inferred region, and the
  // override lives on the Account hub (`BrowseRegionSettingRow`).
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
        <div className="flex h-16 w-full items-center gap-snug px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-cozy sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          {/* THE WORDMARK NEEDS MORE ROOM THAN THE NAV ITEMS NEED FROM EACH OTHER.
              At `gap-cozy` the measured ink gap between "NoDitto" and "Marketplace" was
              13px — the nav's own items are separated by the same amount — so the two
              read as one string, "NoDittoMarketplace", in every desktop capture. The
              brand is a different kind of thing from a section link and the space is
              what says so. */}
          {/* THE SEARCH GIVES WAY, NOT THE CONTROLS. The three columns are equal
              thirds so the search sits on the viewport's centre line, and both side
              columns are `min-w-0`, so a side whose content outgrew its third used to
              squeeze its own children. For a member that happened at every width
              under ~1440px: the rail's 40px icon targets narrowed (to 22px at worst)
              and the name beside the avatar was cut short or vanished.

              From `xl` each side keeps its content width (`min-w-max`) and the search
              takes what is left, which is only ever less than a third when a side
              needs more. Below `xl` there is not enough room for both sides at full
              width, so the old behaviour stands, and the rail drops its Feedback
              label there rather than squeezing further (see `SignedInHeaderTools`). */}
          <div className="flex min-w-0 shrink-0 items-center gap-cozy md:min-w-0 md:flex-1 md:gap-6 xl:min-w-max">
            <Link
              href="/"
              aria-label="NoDitto home"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent text-mist focus:outline-none focus-visible:border-iris"
            >
              <Logo />
            </Link>
            <PrimaryNav isAuthenticated={isAuthenticated} />
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-snug md:flex">
            <HeaderSearch className="market-search" />
          </div>

          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-mist md:flex-1 md:gap-snug xl:min-w-max">
            <HeaderAccountSlot
              isAuthenticated={isAuthenticated && user != null}
              email={user?.email ?? null}
              isAdmin={isAdmin}
              isStaff={isStaff}
              displayName={displayName}
              avatarPath={avatarPath}
              initialNotifications={
                initialNotifications?.ok ? initialNotifications.notifications : []
              }
            />
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
   * On a phone it changes the rendered height on unlisted routes alone (`/help`,
   * `/terms`, `/privacy`), where a guest gets the marketing bar and a member gets
   * none. On the desktop bar it picks which nav links and which account rail the
   * placeholder draws, so the bar does not swap one set for the other on resolve.
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
        <div className="flex h-16 w-full items-center gap-snug px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-cozy sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          {/* Same three columns as the real bar above, CLASS FOR CLASS, including
              `xl:min-w-max` on both sides. From `xl` the side columns are sized by
              their content and the search takes the rest, so a side column that
              drew different content here moved the search when the header
              resolved. That is why what can be real below is real. */}
          <div className="flex min-w-0 shrink-0 items-center gap-cozy md:min-w-0 md:flex-1 md:gap-6 xl:min-w-max">
            <Link
              href="/"
              aria-label="NoDitto home"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent text-mist focus:outline-none focus-visible:border-iris"
            >
              <Logo />
            </Link>
            {/* THE REAL NAV, not a bar. It reads only the pathname and the session
                hint, so there is nothing to wait for — and a 96px bar standing in
                for three or four labelled links was a visible swap on every hard
                load of every desktop route. The hint can only be wrong about the
                Trades link, whose route is protected anyway. */}
            <PrimaryNav isAuthenticated={isAuthenticated} />
          </div>
          <div className="hidden min-w-0 flex-1 justify-center px-snug md:flex">
            {/* `h-8 w-full`: the real field is `md:h-8` and spans this column. This
                was `h-9 max-w-sm`, a narrower, taller box than the one it became.
                `Skeleton` with the tint overridden, because the bar sits on the
                obsidian header rather than on paper. */}
            <Skeleton className="h-8 w-full bg-white/10" />
          </div>
          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-mist md:flex-1 md:gap-snug xl:min-w-max">
            {/* A guest's links need no session, so they render for real. A member's
                tools wait on the session; the placeholder is their footprint. */}
            {isAuthenticated ? <SignedInHeaderToolsPlaceholder /> : <GuestHeaderCtas />}
          </div>
        </div>
      </header>
      <MobileTopChrome isAuthenticated={isAuthenticated} />
    </div>
  );
}
