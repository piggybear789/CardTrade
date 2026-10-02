// app/trades/[id]/loading.tsx
//
// Trade contract room: MarketplaceShell + compact contract header +
// details/chat split. No progress bar — the live room does not have one. The
// placeholder lives beside the room it stands in for, in `components/contract/`.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ContractRoomSkeleton } from '@/components/contract/ContractRoomSkeleton';

export default function TradeContractLoading() {
  return (
    <MarketplaceShellSkeleton title="Trade" flush>
      <ContractRoomSkeleton />
    </MarketplaceShellSkeleton>
  );
}
