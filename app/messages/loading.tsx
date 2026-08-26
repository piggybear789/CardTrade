// app/messages/loading.tsx
//
// Inbox list: large "Inbox" title on phones, grouped card on desktop.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  InboxRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function MessagesLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <div className="mb-1 md:hidden">
          <div className="h-8 w-28 animate-pulse rounded bg-muted" />
        </div>
        <div className="hidden md:block">
          <SectionHeaderSkeleton titleClassName="w-24" descriptionClassName="w-40" />
        </div>
        <div className="max-md:divide-y max-md:divide-border md:divide-y md:divide-border md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card">
          {Array.from({ length: 6 }, (_, index) => (
            <InboxRowSkeleton key={index} />
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
