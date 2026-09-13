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
      {/* No wrapper div — see the note in `sales/loading.tsx`. `OffersSection`'s empty
          state is `SharedEmptyState … compact fill` and wants the same column height. */}
      <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
      {/* Two, not four: this route uses the `SectionFilter` Active/Past preset rather
          than `ContractFilter`. */}
      <SectionFilterSkeleton labels={['Active', 'Past']} />
      <OfferCardListSkeleton count={4} />
    </MarketplaceShellSkeleton>
  );
}
