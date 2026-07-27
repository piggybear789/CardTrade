'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { Button } from '@/components/ui/button';

type NavigationLink = { href: string; label: string };

/** Compact navigation that closes after routing and supports Escape dismissal. */
export function MobileNavigation({
  isAuthenticated,
  personalLinks,
}: {
  isAuthenticated: boolean;
  personalLinks: NavigationLink[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape' || !detailsRef.current?.open) return;
    closeMenu();
    detailsRef.current.querySelector('summary')?.focus();
  }

  return (
    <details ref={detailsRef} onKeyDown={handleKeyDown} className="group relative lg:hidden">
      <summary className="flex size-10 cursor-pointer list-none touch-manipulation items-center justify-center rounded-md hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <Menu className="size-5" aria-hidden="true" />
        <span className="sr-only">Toggle navigation</span>
      </summary>
      <div className="absolute right-0 top-12 z-50 w-[min(18rem,calc(100vw-2rem))] overscroll-contain rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-auction">
        <div className="p-1 sm:hidden"><HeaderSearch /></div>
        <nav aria-label="Mobile navigation" className="grid gap-1">
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/listings" onClick={closeMenu}>Marketplace</Link>
          </Button>
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/listings/new" onClick={closeMenu}>Sell an Item</Link>
          </Button>
          {isAuthenticated ? (
            <>
              <Button asChild variant="ghost" className="justify-start">
                <Link href="/deals" onClick={closeMenu}>Deals</Link>
              </Button>
              <div className="my-1 border-t" />
              {personalLinks.map((link) => (
                <Button key={link.href} asChild variant="ghost" className="justify-start">
                  <Link href={link.href} onClick={closeMenu}>{link.label}</Link>
                </Button>
              ))}
              <SignOutButton className="w-full justify-start" />
            </>
          ) : (
            <>
              <div className="my-1 border-t" />
              <Button asChild variant="ghost" className="justify-start">
                <Link href="/sign-in" onClick={closeMenu}>Sign In</Link>
              </Button>
              <Button asChild className="justify-start">
                <Link href="/sign-up" onClick={closeMenu}>Get Started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </details>
  );
}
