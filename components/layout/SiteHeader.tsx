// components/layout/SiteHeader.tsx
//
// Shared site navigation, mounted once in the root layout so every page gets a
// consistent top bar. A Server Component: it reads the current session via the
// cookie-bound Supabase client and renders auth-aware links. The only client
// island is the sign-out control (see SignOutButton).

import Link from 'next/link';
import { Menu, ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { listMyNotifications } from '@/lib/actions/notifications';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
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
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = Boolean(profile?.is_admin);
  }

  // The top bar stays transactional: browse, sell, deal. Personal sections
  // (messages, notifications, account) live in the marketplace rail, so they
  // only appear in the mobile menu where no rail nav is present.
  const personalLinks = isAuthenticated
    ? [
        { href: '/purchases', label: 'Purchases' },
        { href: '/sales', label: 'Sales' },
        { href: '/trades', label: 'Trades' },
        { href: '/messages', label: 'Messages' },
        { href: '/notifications', label: 'Notifications' },
        { href: '/profile', label: 'Account' },
        ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
      ]
    : [];

  return (
    <header className="market-header relative sticky top-0 z-40 border-b border-white/10 bg-obsidian/95 text-primary-foreground shadow-[0_8px_30px_hsl(var(--obsidian)/0.2)] backdrop-blur supports-[backdrop-filter]:bg-obsidian/90 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold/65 after:to-transparent">
      <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="font-display text-xl font-semibold tracking-[-0.025em] text-parchment">
              CardTrade
            </span>
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
          <HeaderSearch />
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 text-parchment sm:gap-2">
          {isAuthenticated && user ? (
            <>
              {isAdmin ? (
                <nav aria-label="Admin" className="hidden items-center lg:flex">
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/admin">Admin</Link>
                  </Button>
                </nav>
              ) : null}
              <NotificationBell
                userId={user.id}
                initialNotifications={
                  initialNotifications?.ok ? initialNotifications.notifications : []
                }
              />
              <div className="hidden lg:block">
                <SignOutButton />
              </div>
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

          <details className="group relative lg:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
              <Menu className="size-5" aria-hidden />
              <span className="sr-only">Toggle navigation</span>
            </summary>
            <div className="absolute right-0 top-12 z-50 w-64 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-auction">
              <div className="p-1 sm:hidden">
                <HeaderSearch />
              </div>
              <nav aria-label="Mobile navigation" className="grid gap-1">
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings">Marketplace</Link>
                </Button>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings/new">Sell an item</Link>
                </Button>
                {isAuthenticated ? (
                  <>
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/deals">Deals</Link>
                    </Button>
                    <div className="my-1 border-t" />
                    {personalLinks.map((link) => (
                      <Button
                        key={link.href}
                        asChild
                        variant="ghost"
                        className="justify-start"
                      >
                        <Link href={link.href}>{link.label}</Link>
                      </Button>
                    ))}
                    <SignOutButton className="w-full justify-start" />
                  </>
                ) : (
                  <>
                    <div className="my-1 border-t" />
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/sign-in">Sign in</Link>
                    </Button>
                    <Button asChild className="justify-start">
                      <Link href="/sign-up">Get started</Link>
                    </Button>
                  </>
                )}
              </nav>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
