// app/messages/loading.tsx
//
// Inbox list: "Inbox" heading + bordered conversation rows with thumb,
// name/subject, preview, and timestamp.

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
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {Array.from({ length: 6 }, (_, index) => (
            <InboxRowSkeleton key={index} />
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
