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
import { Logo } from '@/components/layout/Logo';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { SiteMenu } from '@/components/layout/SiteMenu';
import { NotificationBell } from '@/components/notifications/NotificationBell';

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

  // Surface the Admin link only to admins. RLS scopes this read to the caller's
  // own profile, so a non-admin can never learn about (or reach) the console.
  let isAdmin = false;
  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, display_name')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = Boolean(profile?.is_admin);
    displayName = profile?.display_name?.trim() || null;
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
          <nav aria-label="Primary" className="hidden items-center text-parchment lg:flex">
            <Button asChild variant="ghost" size="sm">
              <Link href="/listings">Marketplace</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/listings/new">Sell</Link>
            </Button>
            {isAuthenticated ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/deals">Deals</Link>
              </Button>
            ) : null}
          </nav>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-2 sm:flex">
          <HeaderSearch className="market-search" />
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-1 text-parchment sm:min-w-0 sm:flex-1 sm:gap-2">
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
                  className="truncate font-medium"
                  title={displayName ?? 'Your profile'}
                >
                  {displayName ?? 'Profile'}
                </Link>
              </Button>
            </>
          ) : (
            <nav aria-label="Account" className="hidden items-center gap-1 lg:flex">
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="border-gold bg-gold text-obsidian hover:bg-gold/90"
              >
                <Link href="/sign-up">Get started</Link>
              </Button>
            </nav>
          )}

          <SiteMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}
