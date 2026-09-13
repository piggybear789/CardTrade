// app/listings/mine/loading.tsx
//
// My Listings renders catalog tiles (`CatalogItemCard`), not bordered action
// cards, in the uniform `CATALOG_TILE_GRID` at every width. Every tile is the
// viewer's own, so `ListingsSection` passes `seller: null` and the tiles have no
// seller row.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  CatalogTileGridSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function MyListingsLoading() {
  return (
    <MarketplaceShellSkeleton
      title="My Listings"
      primaryAction={
        <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
      }
    >
      {/* No wrapper div — see the note in `saved/loading.tsx`. */}
      <SectionHeaderSkeleton hasMobileAction />
      <CatalogTileGridSkeleton count={8} hasSeller={false} />
    </MarketplaceShellSkeleton>
  );
}
