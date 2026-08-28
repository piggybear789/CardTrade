// app/listings/mine/loading.tsx
//
// My Listings renders catalog tiles (`CatalogItemCard`), not
// bordered action cards. Same 2-up / auto-fill grid as the marketplace.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  CatalogGridSkeleton,
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
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <CatalogGridSkeleton count={8} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
