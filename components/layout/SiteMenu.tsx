'use client';

// components/layout/SiteMenu.tsx
//
// Overflow menu for the site header. Section navigation lives in the desktop
// rail and mobile bottom hubs — this panel keeps search (narrow viewports),
// secondary account links, admin, and sign-out so the burger never dumps the
// full workspace map. Closes on outside click, Escape, and every route change.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { SignOutButton } from '@/components/layout/SignOutButton';
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
}

export function SiteMenu({ isAuthenticated, isAdmin, isStaff = false }: SiteMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
            {!isAuthenticated ? (
              <>
                <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                  Browse
                </p>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings">Marketplace</Link>
                </Button>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/listings/new">Sell an item</Link>
                </Button>
                <div className="my-1 border-t" />
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild className="justify-start">
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                  More
                </p>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/saved">Saved</Link>
                </Button>
                <Button asChild variant="ghost" className="justify-start">
                  <Link href="/notifications">Notifications</Link>
                </Button>
                {isStaff || isAdmin ? (
                  <>
                    <div className="my-1 border-t" />
                    <p className="market-label px-3 pb-1 pt-2 text-muted-foreground">
                      Staff
                    </p>
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/admin/arbitration">Cases</Link>
                    </Button>
                    {isAdmin ? (
                      <Button asChild variant="ghost" className="justify-start">
                        <Link href="/admin">Operations</Link>
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <div className="my-1 border-t" />
                <SignOutButton className="w-full justify-start" />
              </>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
