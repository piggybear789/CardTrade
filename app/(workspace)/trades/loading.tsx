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
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction />
        <SectionFilterSkeleton />
        {/* The group heading — "Open", "Agreed" or "Finished" — which this
            placeholder used to skip. The list is always inside a labelled
            section, so 35.8px of `text-subhead` plus `mb-3` appeared between the
            tabs and the first row on every load. */}
        <TextLines className="mb-3 text-subhead" widths={['w-24']} />
        {/* The trade glyph is `size-12` at every width, and the swap label
            ("Your item X ↔ Their item Y") clamps to two lines. */}
        <ContractCardListSkeleton count={5} titleLines={2} thumbClassName="size-12" />
      </div>
    </MarketplaceShellSkeleton>
  );
}
