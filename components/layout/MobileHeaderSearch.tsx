'use client';

// Icon-only marketplace search below `md`. The persistent header field is a
// desktop pattern — on a phone it starves the wordmark and the account cluster.
// Catalog (`/listings`) owns its own field. Auth, legal, sell, inbox, account,
// and admin have no search job, so the icon stays off those routes.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

function hideMobileHeaderSearch(pathname: string): boolean {
  if (pathname === '/listings' || pathname.startsWith('/listings/')) return true;
  if (pathname.endsWith('/edit')) return true;
  if (
    pathname === '/sign-in' ||
    pathname === '/sign-up' ||
    pathname === '/forgot-password' ||
    pathname === '/account-suspended' ||
    pathname === '/help' ||
    pathname === '/terms' ||
    pathname === '/privacy'
  ) {
    return true;
  }
  return (
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/messages') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/admin')
  );
}

export function MobileHeaderSearch() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (hideMobileHeaderSearch(pathname)) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search listings"
        aria-expanded={open}
        className="flex size-11 touch-manipulation items-center justify-center rounded-md border border-transparent text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:border-gold md:hidden"
      >
        <Search className="size-5" aria-hidden />
      </button>
      <SheetContent
        side="top"
        className="gap-3 border-white/15 bg-obsidian p-4 text-parchment"
      >
        <SheetHeader>
          <SheetTitle className="text-parchment">Search listings</SheetTitle>
          <SheetDescription className="text-parchment/70">
            Find a card, set, or player.
          </SheetDescription>
        </SheetHeader>
        <HeaderSearch
          className="market-search"
          ariaLabel="Search listings"
          autoFocus
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
