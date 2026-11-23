// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. Client islands:
// search, guest CTAs, primary nav, the bell, and the desktop burger.
//
// Phone chrome is a separate borderless strip (`MobileTopChrome`). The bar
// below is desktop-only (`md+`). Both are the page colour; the bar's surface
// and edge live in `SiteHeaderBar`.

import Link from 'next/link';

import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import { HeaderAccountSlot } from '@/components/layout/HeaderAccountSlot';
import { Logo } from '@/components/layout/Logo';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { MobileTopChrome } from '@/components/layout/MobileTopChrome';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { SiteHeaderBar } from '@/components/layout/SiteHeaderBar';

export async function SiteHeader() {
  const user = await getCachedAuthUser();
  const isAuthenticated = Boolean(user);

  // Seed the notification bell with a server-fetched snapshot so it is populated
  // on first paint, before the realtime channel opens. Read alongside the profile:
  // neither waits on the other.
  const [initialNotifications, profile] = user
    ? await Promise.all([listMyNotifications(), getCachedProfile(user.id)])
    : [null, null];

  // No region control here: the catalog uses the inferred region, and the
  // override lives on the Account hub (`BrowseRegionSettingRow`).
  const isAdmin = Boolean(profile?.is_admin);
  const isStaff = isAdmin || Boolean(profile?.is_support);
  const displayName = profile?.display_name?.trim() || null;
  const avatarPath = (profile?.avatar_path as string | null) ?? null;

  // Sticky isolation wraps both chromes so view-transition-name stays unique.
  // The bar is `md+` only; the phone strip is phone-only.
  //
  // SOLID, NOT FROSTED. A sticky backdrop filter makes the compositor re-blur
  // whatever scrolls under it on every frame, so the bar is an opaque page-coloured
  // surface (`SiteHeaderBar`) rather than a translucent one.
  return (
    <div
      style={{ viewTransitionName: 'site-header' }}
      className="sticky top-0 z-40"
    >
      <SiteHeaderBar>
        <div className="flex h-16 w-full items-center gap-snug px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-cozy sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
          {/* THE WORDMARK NEEDS MORE ROOM THAN THE NAV ITEMS NEED FROM EACH OTHER.
              At `gap-cozy` the measured ink gap between "NoDitto" and "Marketplace" was
              13px — the nav's own items are separated by the same amount — so the two
              read as one string, "NoDittoMarketplace", in every desktop capture. The
              brand is a different kind of thing from a section link and the space is
              what says so. */}
          {/* THE SEARCH GIVES WAY, NOT THE CONTROLS. Each side column keeps its
              content width and the search takes what is left. Equal thirds put the
              search on the viewport's centre line, but a side whose content outgrew
              its third then overflowed into the search: under 1280px the nav ran over
              the wordmark on one side and under the search field on the other.

              From `xl` there is room for thirds again (`flex-1` with a `min-w-max`
              floor), so the search re-centres. Below it, the nav sheds its secondary
              links (see `PrimaryNav`) so the search keeps a usable width. */}
          <div className="flex shrink-0 items-center gap-cozy md:gap-6 xl:min-w-max xl:flex-1">
            <Link
              href="/"
              aria-label="NoDitto home"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent text-foreground focus:outline-none focus-visible:border-ring"
            >
              <Logo />
            </Link>
            <PrimaryNav isAuthenticated={isAuthenticated} />
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-snug md:flex">
            <HeaderSearch className="market-search" />
          </div>

          <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 text-foreground md:gap-snug xl:min-w-max xl:flex-1">
            <HeaderAccountSlot
              isAuthenticated={isAuthenticated && user != null}
              email={user?.email ?? null}
              userId={user?.id ?? null}
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
      </SiteHeaderBar>
      <MobileTopChrome isAuthenticated={isAuthenticated} />
    </div>
  );
}
