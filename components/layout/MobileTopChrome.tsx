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
import { resolveMobileChrome } from '@/components/layout/mobile-chrome/routes';

const ListingDetailChrome = dynamic(() =>
  import('@/components/layout/mobile-chrome/variants').then((mod) => mod.ListingDetailChrome),
);
const HierarchicalChrome = dynamic(() =>
  import('@/components/layout/mobile-chrome/variants').then((mod) => mod.HierarchicalChrome),
);
const HubChrome = dynamic(() =>
  import('@/components/layout/mobile-chrome/variants').then((mod) => mod.HubChrome),
);
const AuthChrome = dynamic(() =>
  import('@/components/layout/mobile-chrome/variants').then((mod) => mod.AuthChrome),
);
const MarketingChrome = dynamic(() =>
  import('@/components/layout/mobile-chrome/variants').then((mod) => mod.MarketingChrome),
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
