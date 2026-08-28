// app/offers/loading.tsx
//
// Offers list: heading, Browse CTA, Active/Past tabs, then card rows with
// a listing thumbnail — not a boxed table.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function OffersLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Offers"
      primaryAction={
        <RailPrimaryAction href="/" glyph={null}>
          Browse Marketplace
        </RailPrimaryAction>
      }
    >
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
        <SectionFilterSkeleton />
        <ContractCardListSkeleton count={4} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
