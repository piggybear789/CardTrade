// app/trades/[id]/loading.tsx
//
// Trade contract room: MarketplaceShell + compact contract header +
// details/chat split. No progress bar — the live room does not have one.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ContractRoomSkeleton } from '@/components/layout/WorkspaceSkeletons';

export default function TradeContractLoading() {
  return (
    <MarketplaceShellSkeleton flush>
      <ContractRoomSkeleton />
    </MarketplaceShellSkeleton>
  );
}
