// app/purchases/loading.tsx
//
// Purchases: heading, Browse CTA, Active/Past tabs, cash-sale cards.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function PurchasesLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Purchases"
      primaryAction={
        <RailPrimaryAction href="/" glyph={null}>
          Browse Marketplace
        </RailPrimaryAction>
      }
    >
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <SectionFilterSkeleton />
        <ContractCardListSkeleton count={4} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
