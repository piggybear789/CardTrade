// app/sales/loading.tsx
//
// Sales inbox matches purchases: heading, Create Listing CTA, Active/Past
// tabs, then cash-sale cards.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function SalesLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Sales"
      primaryAction={
        <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
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
