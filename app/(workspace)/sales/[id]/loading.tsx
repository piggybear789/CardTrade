// app/sales/[id]/loading.tsx
//
// Cash-sale contract room uses the same header + details/chat split as trades. The
// placeholder lives beside the room it stands in for, in `components/contract/`.
//
// No `title`: the real shell reads "Purchase" or "Sale" depending on which side of
// the contract the viewer is, which is not known until the row loads, so the shell
// skeleton reserves the heading's line box instead.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ContractRoomSkeleton } from '@/components/contract/ContractRoomSkeleton';

export default function CashSaleContractLoading() {
  return (
    <MarketplaceShellSkeleton flush>
      <ContractRoomSkeleton />
    </MarketplaceShellSkeleton>
  );
}
