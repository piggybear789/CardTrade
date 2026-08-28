// app/listings/mine/loading.tsx
//
// My Listings renders catalog tiles (`CatalogItemCard`), not
// bordered action cards. Same 2-up / auto-fill grid as the marketplace.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  CatalogGridSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function MyListingsLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <CatalogGridSkeleton count={8} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
