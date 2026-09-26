// app/saved/loading.tsx
//
// Watchlist uses the same compact catalog tiles as browse, but in the uniform
// grid rather than the phone mosaic — `WatchlistSection` renders
// `CATALOG_TILE_GRID` at every width.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { CatalogTileGridSkeleton } from '@/components/layout/catalogSkeletons';
import { SectionHeaderSkeleton } from '@/components/layout/WorkspaceSkeletons';

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
      {/* No wrapper div: `saved/page.tsx` renders `SectionHeader` and
          `WatchlistSection` as direct children of the shell, so the div that used to be
          here was a node the real page does not have. */}
      <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
      <CatalogTileGridSkeleton count={8} />
    </MarketplaceShellSkeleton>
  );
}
