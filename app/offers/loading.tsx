// app/offers/loading.tsx
//
// Offers list: heading, Browse CTA, Active/Past tabs, then card rows with
// a listing thumbnail — not a boxed table.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  ContractCardListSkeleton,
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function OffersLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0">
        <SectionHeaderSkeleton hasMobileAction titleClassName="w-28" />
        <SectionFilterSkeleton />
        <ContractCardListSkeleton count={4} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
