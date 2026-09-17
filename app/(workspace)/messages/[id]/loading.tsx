// app/messages/[id]/loading.tsx
//
// Conversation thread: flush shell so the composer stays in the viewport,
// matching ChatThread (person bar, item context, bubbles, composer).
//
// THE LIST PANE IS RESERVED HERE TOO. From `lg` the real page puts the thread beside a
// 21rem list (`InboxTwoPane`); a skeleton that draws only the thread renders it full
// width and then shunts it 21rem sideways the moment data lands, which is a worse loading
// state than a slower one.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  ChatThreadSkeleton,
  InboxRowSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
import { PANE_BAR_MIN_H } from '@/components/messages/threadGeometry';

export default function ConversationLoading() {
  return (
    <MarketplaceShellSkeleton title="Messages" flush fill>
      <div className="flex min-h-0 flex-1 items-stretch">
        <aside
          className="hidden min-w-0 flex-col border-r border-border bg-card lg:flex lg:w-[21rem] lg:shrink-0 xl:w-[23rem]"
          aria-hidden
        >
          {/* Same bar geometry as the pane it stands in for — height from the one
              constant both real bars use, so this cannot be the copy that drifts. */}
          <div
            className={`flex shrink-0 items-center border-b bg-card px-cozy py-2.5 ${PANE_BAR_MIN_H}`}
          />
          <div className="min-h-0 flex-1 divide-y divide-border overflow-hidden">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="px-cozy">
                <InboxRowSkeleton />
              </div>
            ))}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatThreadSkeleton />
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
