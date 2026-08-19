// app/sales/[id]/loading.tsx
//
// Cash-sale contract room uses the same header + details/chat split as trades.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ContractRoomSkeleton } from '@/components/layout/WorkspaceSkeletons';

export default function CashSaleContractLoading() {
  return (
    <MarketplaceShellSkeleton flush>
      <ContractRoomSkeleton />
    </MarketplaceShellSkeleton>
  );
}
