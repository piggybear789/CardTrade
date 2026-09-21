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
import { TextLines } from '@/components/ui/skeleton';

export default function TradesLoading() {
  return (
    <MarketplaceShellSkeleton title="Trades" primaryAction={<StartDealRailAction />}>
      {/* NO WRAPPER DIV, and that is the fix rather than a tidy-up. `trades/page.tsx`
          renders `SectionHeader`, `ContractFilter` and the list as DIRECT children of
          `MarketplaceShell`, whose content box is `flex min-h-0 w-full flex-col` +
          `flex-1`. The `min-w-0` div that used to be here was an extra node the real
          page does not have, and it broke that chain: the empty state on this route is
          `StartDealEmptyState … compact fill`, and `fill` resolves to `flex-1`, which
          claims height only as far as the flex chain reaches. So a member with no trades
          watched a content-height stack become a full-column island. */}
      <SectionHeaderSkeleton hasMobileAction />
      <SectionFilterSkeleton labels={['Active', 'Needs you', 'Waiting', 'Past']} />
      {/* The group heading — "Open", "Waiting on you", "Finished" — which this
          placeholder used to skip. The list is always inside a labelled section, so
          35.8px of `text-subhead` plus `mb-cozy` appeared between the tabs and the first
          row on every load. */}
      <TextLines className="mb-cozy text-subhead" widths={['w-24']} />
      {/* The swap label ("X ↔ Y") clamps to two lines. */}
      <ContractCardListSkeleton count={5} titleLines={2} />
    </MarketplaceShellSkeleton>
  );
}
