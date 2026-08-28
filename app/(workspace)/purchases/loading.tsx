// app/purchases/loading.tsx
//
// Purchases: heading, Browse CTA, Active/Past tabs, cash-sale cards.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function PurchasesLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <SectionFilterSkeleton />
        <ContractCardListSkeleton count={4} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
