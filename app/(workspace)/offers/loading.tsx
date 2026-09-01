// app/offers/loading.tsx
//
// Offers list: heading, Browse CTA, Active/Past tabs, then card rows with a
// listing thumbnail — not a boxed table.
//
// Offers keep their cards on the phone. Unlike Trades, Purchases and Sales,
// which go full-bleed and hairline-divided below `md`, `OffersSection` is
// `space-y-cozy` over bordered `p-cozy` cards at every width — hence its own
// placeholder rather than `ContractCardListSkeleton`.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  OfferCardListSkeleton,
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
        <OfferCardListSkeleton count={4} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
