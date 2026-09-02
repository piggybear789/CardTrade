'use client';

// Phone-only top chrome. Desktop keeps the dark SiteHeader; this strip is
// cream, borderless, and composed per screen instead of one header with modes.

import { usePathname } from 'next/navigation';

import {
  AuthChrome,
  CatalogChrome,
  HierarchicalChrome,
  HubChrome,
  ListingDetailChrome,
  MarketingChrome,
} from '@/components/layout/mobile-chrome/variants';
import { resolveMobileChrome } from '@/components/layout/mobile-chrome/routes';

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
