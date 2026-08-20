// app/saved/loading.tsx
//
// Watchlist uses the same auction-card grid as ItemCard (default variant),
// plus the section heading and the rail/mobile Browse CTA.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  AuctionGridSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function SavedLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
        <AuctionGridSkeleton count={8} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
