// app/messages/loading.tsx
//
// Inbox list: same SectionHeader as Saved / Purchases, grouped card on desktop.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  InboxRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function MessagesLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <SectionHeaderSkeleton titleClassName="w-24" descriptionClassName="w-40" />
        <div className="max-md:divide-y max-md:divide-border md:divide-y md:divide-border md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card">
          {Array.from({ length: 6 }, (_, index) => (
            <InboxRowSkeleton key={index} />
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
