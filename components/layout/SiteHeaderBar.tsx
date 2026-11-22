'use client';

// components/layout/SiteHeaderBar.tsx
//
// The desktop header's surface: the `<header>` element, its colour and its bottom
// edge. A client island for one reason, the same one `PrimaryNav` gives: `SiteHeader`
// is a Server Component and cannot read the path or the scroll position. Everything
// inside the bar is still rendered by the server and passed through as `children`.
//
// THE BAR IS THE PAGE COLOUR. It was a solid obsidian band over a white page, so every
// screen opened with a heavy dark stripe the content had nothing to do with. It is now
// `--background`, the same white as the content column, and the bar is told apart by a
// hairline rather than by a second colour (the Vercel, Stripe and GitHub pattern).
//
// SEAMLESS ON REFERENCES. Those pages are a centred hero with a soft glow and a column
// of floating cards, and a hairline across the top cut the composition off from the bar
// above it. There the edge is transparent until the page scrolls, and only then fades
// in, so the header and the page read as one surface at rest and the bar still has an
// edge once content passes under it.
//
// THE BORDER IS ALWAYS 1px, only its colour changes. The rail's sticky offset and every
// flush room's height subtract `4rem + 1px` (see `MarketplaceShell`), so dropping the
// border instead of hiding it would make each of them 1px wrong.

import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Routes whose header has no visible edge until the page is scrolled. */
function isSeamlessRoute(pathname: string): boolean {
  return pathname === '/references' || pathname.startsWith('/references/');
}

function subscribeToScroll(onChange: () => void): () => void {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}

function subscribeToNothing(): () => void {
  return () => {};
}

const readScrolled = () => window.scrollY > 0;
// The server never knows the scroll position, so it renders the resting state.
const readScrolledOnServer = () => false;

/**
 * Whether the document has scrolled at all. Listens only while `active`, so routes with
 * a permanent edge do not re-render the bar on every scroll past the top.
 */
function useScrolled(active: boolean): boolean {
  const scrolled = useSyncExternalStore(
    active ? subscribeToScroll : subscribeToNothing,
    readScrolled,
    readScrolledOnServer,
  );
  return active && scrolled;
}

export function SiteHeaderBar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const seamless = isSeamlessRoute(pathname);
  const scrolled = useScrolled(seamless);

  return (
    <header
      className={cn(
        'market-header relative hidden border-b bg-background pt-[env(safe-area-inset-top)] text-foreground transition-[border-color] duration-150 motion-reduce:transition-none md:block',
        seamless && !scrolled ? 'border-transparent' : 'border-border',
      )}
    >
      {children}
    </header>
  );
}
