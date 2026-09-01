// app/messages/loading.tsx
//
// Inbox list: same SectionHeader as Saved / Purchases, grouped card on desktop.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  InboxRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
import { MobileList } from '@/components/ui/mobile-list';

export default function MessagesLoading() {
  return (
    <MarketplaceShellSkeleton title="Messages">
      <div className="min-w-0">
        <SectionHeaderSkeleton titleClassName="w-24" descriptionClassName="w-40" />
        {/* `MobileList` itself rather than a hand-copied class string. The copy
            that was here had drifted by a `md:shadow-market`, and borrowing the
            component is the only way the two cannot drift again. */}
        <MobileList variant="sheet">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <InboxRowSkeleton />
            </li>
          ))}
        </MobileList>
      </div>
    </MarketplaceShellSkeleton>
  );
}
