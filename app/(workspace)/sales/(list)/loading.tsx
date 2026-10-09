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
        <RailPrimaryAction href="/listings/new">Sell an item</RailPrimaryAction>
      }
    >
      {/* No wrapper div: `sales/page.tsx` hangs these straight off `MarketplaceShell`,
          and an extra node here breaks the `flex-1` chain that `ContractScopeEmptyState`
          (`EmptyState … compact fill`) needs to claim the column's height. */}
      <SectionHeaderSkeleton hasMobileAction mobileActionClassName="w-[8.5rem]" />
      <SectionFilterSkeleton labels={['Active', 'Needs you', 'Waiting', 'Past']} />
      <ContractCardListSkeleton count={4} />
    </MarketplaceShellSkeleton>
  );
}
