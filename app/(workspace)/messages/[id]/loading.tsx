// app/messages/[id]/loading.tsx
//
// Conversation thread: flush shell so the composer stays in the viewport,
// matching ChatThread (person bar, item context, bubbles, composer).

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { ChatThreadSkeleton } from '@/components/layout/WorkspaceSkeletons';

export default function ConversationLoading() {
  return (
    <MarketplaceShellSkeleton title="Messages" flush>
      <ChatThreadSkeleton />
    </MarketplaceShellSkeleton>
  );
}
