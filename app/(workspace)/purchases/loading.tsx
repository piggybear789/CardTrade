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
      {/* No wrapper div — see the note in `sales/loading.tsx`. */}
      <SectionHeaderSkeleton hasMobileAction />
      <SectionFilterSkeleton labels={['Active', 'Needs you', 'Waiting', 'Past']} />
      <ContractCardListSkeleton count={4} />
    </MarketplaceShellSkeleton>
  );
}
