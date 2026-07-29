'use client';

// components/layout/SiteMenu.tsx
//
// The single burger menu for the site header. Session and account controls
// live here instead of crowding the top bar, and the account links sit behind
// an expandable group so opening the menu never dumps a wall of links at once.
// Closes on outside click, Escape, and every route change.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { cn } from '@/lib/utils';

export interface SiteMenuProps {
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export function SiteMenu({ isAuthenticated, isAdmin }: SiteMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Never leave the menu hanging open after a navigation.
  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
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

  const accountLinks = isAuthenticated
    ? [
        { href: '/purchases', label: 'Purchases' },
        { href: '/sales', label: 'Sales' },
        { href: '/trades', label: 'Trades' },
        { href: '/deals', label: 'Deals' },
        { href: '/offers', label: 'Offers' },
        { href: '/saved', label: 'Saved' },
        { href: '/messages', label: 'Messages' },
        { href: '/notifications', label: 'Notifications' },
        { href: '/profile', label: 'Account' },
        ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
      ]
    : [];

  return (
    <div
      ref={containerRef}
      className={cn('relative', !isAuthenticated && 'lg:hidden')}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex size-10 touch-manipulation items-center justify-center rounded-md hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {open ? (
          <X className="size-5" aria-hidden />
        ) : (
          <Menu className="size-5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          id="site-menu-panel"
          className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-5rem)] w-[min(18rem,calc(100vw-2rem))] origin-top-right overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-auction animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
        >
          <div className="p-1 sm:hidden">
            <HeaderSearch />
          </div>

          <nav aria-label="Menu" className="grid gap-1">
            <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">Browse</p>
            <Button asChild variant="ghost" className="justify-start">
              <Link href="/listings">Marketplace</Link>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <Link href="/listings/new">Sell an item</Link>
            </Button>
            {isAuthenticated ? (
              <Button asChild variant="ghost" className="justify-start">
                <Link href="/deals">Deals</Link>
              </Button>
            ) : null}

            {isAuthenticated ? (
              <>
                <div className="my-1 border-t" />
                <button
                  type="button"
                  onClick={() => setAccountOpen((value) => !value)}
                  aria-expanded={accountOpen}
                  aria-controls="site-menu-account"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="market-label text-muted-foreground">Your account</span>
                  <ChevronDown
                    className={cn(
                      'size-4 text-muted-foreground transition-transform duration-150',
                      accountOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>
                {accountOpen ? (
                  <div
                    id="site-menu-account"
                    className="grid gap-1 animate-in fade-in-0 slide-in-from-top-1 duration-150"
                  >
                    {accountLinks.map((link) => (
                      <Button
                        key={link.href}
                        asChild
                        variant="ghost"
                        className="justify-start"
                      >
                        <Link href={link.href}>{link.label}</Link>
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="my-1 border-t" />
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
      ) : null}
    </div>
  );
}
