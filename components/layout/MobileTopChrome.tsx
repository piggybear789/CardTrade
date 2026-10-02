'use client';

// Phone-only top chrome. Desktop keeps the dark SiteHeader; this strip is
// cream, borderless, and composed per screen instead of one header with modes.
//
// Catalog chrome is static because `/` is the page people actually land on.
// The other modes share a chunk that loads when a non-catalog route renders
// them, so the marketplace does not download report, share, and form chrome
// before the first grid.

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import { CatalogChrome } from '@/components/layout/mobile-chrome/CatalogChrome';
import { MobileChromeFrame } from '@/components/layout/mobile-chrome/primitives';
import { resolveMobileChrome } from '@/components/layout/mobile-chrome/routes';

// EVERY LAZY VARIANT RESERVES ITS FRAME. `next/dynamic` with no `loading` renders
// null until the chunk arrives, and a hard load hides that (the server rendered the
// variant and hydration waits for it) — but the FIRST client navigation into a
// non-catalog route does not. Tapping a listing from `/` mounted a new lazy
// boundary, the 54px strip collapsed to nothing, and the page underneath jumped up
// and back down once the chunk landed. The fallback is the empty frame at the
// variant's own height: `MobileChromeFrame` is the thing that fixes that height, so
// an empty one is an exact stand-in.
const barFallback = () => <MobileChromeFrame />;
const compactFallback = () => <MobileChromeFrame compact />;

const ListingDetailChrome = dynamic(
  () => import('@/components/layout/mobile-chrome/variants').then((mod) => mod.ListingDetailChrome),
  { loading: barFallback },
);
const HierarchicalChrome = dynamic(
  () => import('@/components/layout/mobile-chrome/variants').then((mod) => mod.HierarchicalChrome),
  { loading: barFallback },
);
const HubChrome = dynamic(
  () => import('@/components/layout/mobile-chrome/variants').then((mod) => mod.HubChrome),
  { loading: compactFallback },
);
const AuthChrome = dynamic(
  () => import('@/components/layout/mobile-chrome/variants').then((mod) => mod.AuthChrome),
  { loading: barFallback },
);
const MarketingChrome = dynamic(
  () => import('@/components/layout/mobile-chrome/variants').then((mod) => mod.MarketingChrome),
  { loading: barFallback },
);

export function MobileTopChrome({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const pathname = usePathname();
  const kind = resolveMobileChrome(pathname, isAuthenticated);

  switch (kind) {
    case 'catalog':
      return <CatalogChrome isAuthenticated={isAuthenticated} />;
    case 'listing-detail':
      return <ListingDetailChrome isAuthenticated={isAuthenticated} />;
    case 'hierarchical':
      return <HierarchicalChrome pathname={pathname} />;
    case 'hub':
    case 'thread':
      return <HubChrome />;
    case 'auth':
      return <AuthChrome />;
    case 'marketing':
      return <MarketingChrome isAuthenticated={isAuthenticated} />;
  }
}
