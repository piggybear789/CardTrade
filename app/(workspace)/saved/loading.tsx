// app/saved/loading.tsx
//
// Watchlist uses the same compact catalog tiles as browse.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  CatalogGridSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function SavedLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Saved"
      primaryAction={
        <RailPrimaryAction href="/" glyph={null}>
          Browse Marketplace
        </RailPrimaryAction>
      }
    >
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
        <CatalogGridSkeleton count={8} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
