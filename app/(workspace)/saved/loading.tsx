// app/saved/loading.tsx
//
// Watchlist uses the same compact catalog tiles as browse.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  CatalogGridSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function SavedLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
        <CatalogGridSkeleton count={8} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
