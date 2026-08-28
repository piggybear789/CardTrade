// app/trades/loading.tsx
//
// Trades inbox: section heading + Active/Past tabs + stacked contract cards.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { StartDealRailAction } from '@/components/deals/StartDealButton';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function TradesLoading() {
  return (
    <MarketplaceShellSkeleton title="Trades" primaryAction={<StartDealRailAction />}>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <SectionFilterSkeleton />
        <ContractCardListSkeleton count={5} thumbSize="sm" />
      </div>
    </MarketplaceShellSkeleton>
  );
}
