// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. The only client
// island is the sign-out control (see SignOutButton).

import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  // Seed the notification bell with a server-fetched snapshot so it is populated
  // on first paint, before the realtime channel opens.
  const initialNotifications = isAuthenticated
    ? (await listMyNotifications())
    : null;

  // Which region the catalog is scoped to, for the read-only indicator. The header
  // has no `searchParams`, so an explicit `?region=` on the current URL is not
  // visible here — the indicator therefore shows the member's own region, their
  // remembered choice, or the IP guess. That is the right thing for a persistent
  // chrome element: it states their standing scope, while the marketplace's own
  // controls state and change the scope of the page in front of them.
  //
  // Resolved WITHOUT `resolveBrowseRegion` on the signed-in path. That helper does
  // its own `auth.getUser()` and its own `profiles` read, both of which this
  // component has already done a few lines below — and this header renders on every
  // route in the app, so paying for them twice is a cost on every page load. The
  // signed-in region therefore comes from the profile read that is happening anyway,
  // and the helper is called only for anonymous visitors, where it does no database
  // work at all (cookie, then IP header, then the default).
  let region: ResolvedRegion;

  // Surface the staff links only to staff. RLS scopes this read to the caller's own
  // profile, so a member can never learn about (or reach) either surface.
  //
  // Two capabilities, read separately: `is_support` may arbitrate, `is_admin` may also
  // moderate. An admin sees both links; a support worker sees only Arbitration. This is
  // navigation only — `requireStaff` / `requireAdmin` re-check on every action, because
  // hiding a link is not authorization.
  let isAdmin = false;
  let isStaff = false;
  let displayName: string | null = null;
  let avatarPath: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, is_support, display_name, region_code, avatar_path')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = Boolean(profile?.is_admin);
    isStaff = isAdmin || Boolean(profile?.is_support);
    displayName = profile?.display_name?.trim() || null;
    avatarPath = (profile?.avatar_path as string | null) ?? null;

    const own = normalizeRegionCode(profile?.region_code);
    // Falls back to the anonymous chain for a member who has not set a region yet —
    // a Profile predating 0065. Showing them nothing would be worse than showing the
    // scope their catalog is actually using.
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
    <header className="market-header relative sticky top-0 z-40 border-b border-white/10 bg-obsidian/95 pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold/65 after:to-transparent">
      <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
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

        <div className="hidden min-w-0 flex-1 justify-center px-2 sm:flex">
          <HeaderSearch className="market-search" />
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-1 text-parchment sm:min-w-0 sm:flex-1 sm:gap-2">
          <RegionIndicator regionCode={region.code} source={region.source} />
          {isAuthenticated && user ? (
            <>
              <NotificationBell
                userId={user.id}
                initialNotifications={
                  initialNotifications?.ok ? initialNotifications.notifications : []
                }
              />
              <Button asChild variant="ghost" size="sm" className="max-w-[9rem] sm:max-w-[14rem]">
                <Link
                  href="/profile"
                  /* No font override: the Button already supplies the header's
                     `text-sm font-semibold`. This carried `font-medium`, which
                     quietly stepped the name down a weight from the nav links
                     sitting a few pixels away. */
                  className="flex items-center gap-2"
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
                  <span className="truncate">{displayName ?? 'Profile'}</span>
                </Link>
              </Button>
            </>
          ) : (
            <nav aria-label="Account" className="hidden items-center gap-1 lg:flex">
              <Button asChild variant="ghost" size="sm">
                <SignInLink>Sign in</SignInLink>
              </Button>
              <Button
                asChild
                size="sm"
                className="border-gold bg-gold text-obsidian hover:bg-gold/90"
              >
                <SignInLink target="/sign-up">Get started</SignInLink>
              </Button>
            </nav>
          )}

          <SiteMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} isStaff={isStaff} />
        </div>
      </div>
    </header>
  );
}
