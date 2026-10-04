'use client';

// components/messages/ThreadPane.tsx
//
// The thread side of the two-pane inbox, and what it shows while a click is in flight.
//
// A thread is still rendered and authorised by the server: `/messages/[id]` is a real
// route and every switch is a real navigation. What changes is what the pane does while
// that navigation runs. It used to hold the old thread (no prefetch, as in `next dev`)
// or blank to a skeleton of the whole page (a prefetched loader). Now a click shows the
// thread it opens AT ONCE, drawn from what the client already holds:
//
//   - its header, from the inbox list entry — name, avatar, listing, price, contract
//     state — which is the same data `getConversation` reads for the real header;
//   - its messages, if it has been open in this tab (`InboxProvider.rememberThread`),
//     otherwise placeholder bubbles in the log alone.
//
// The real thread replaces the preview when the server answers. The preview is the same
// component in `preview` mode, so the swap changes nothing you can see.
//
// TWO PLACES DRAW THE PREVIEW, and they cover the two ways a navigation can wait:
//
//   - HERE, while the router has not committed the click (`pendingId`). That is every
//     click in `next dev`, which never prefetches, and any click whose prefetch has not
//     finished. The old thread stays mounted but hidden, so a click back to it while the
//     new one is in flight is instant too.
//   - `messages/(thread)/[id]/loading.tsx`, once it has: the router commits a prefetched
//     route straight to its loading boundary, and the boundary draws the same preview
//     until the page streams in.

import type { ReactNode } from 'react';

import { ChatThreadSkeleton } from '@/components/layout/WorkspaceSkeletons';
import { ChatThread } from '@/components/messages/ChatThread';
import { useInbox } from '@/components/messages/InboxProvider';
import { cn } from '@/lib/utils';

/** The pane around the routed thread (`children`). */
export function ThreadPane({ children }: { children: ReactNode }) {
  const inbox = useInbox();
  const pendingId = inbox?.pendingId ?? null;

  return (
    <>
      {pendingId ? <ThreadPreview key={pendingId} conversationId={pendingId} /> : null}
      {/* `hidden` as a CLASS, not the attribute: Tailwind's `flex` is an author style
          and would beat the user-agent `[hidden]` rule. `min-h-0` keeps the shrink
          chain from the shell down to the log's scroll box unbroken. */}
      <div className={cn('min-h-0 min-w-0 flex-1 flex-col', pendingId ? 'hidden' : 'flex')}>
        {children}
      </div>
    </>
  );
}

/**
 * One thread drawn from client state alone, or the generic thread skeleton when the
 * client knows nothing about it — a thread missing from the list, or no inbox at all.
 */
export function ThreadPreview({ conversationId }: { conversationId: string | null }) {
  const inbox = useInbox();
  const entry = conversationId
    ? inbox?.conversations.find((candidate) => candidate.id === conversationId)
    : undefined;
  if (!inbox || !entry) return <ChatThreadSkeleton />;

  const cached = inbox.cachedThread(entry.id);
  return (
    <ChatThread
      preview
      conversationId={entry.id}
      currentUserId={inbox.currentUserId}
      otherName={entry.other.displayName}
      otherAvatarPath={entry.other.avatarPath ?? null}
      item={entry.item}
      trade={entry.trade}
      sale={entry.sale}
      shipment={cached?.shipment ?? null}
      initialMessages={cached?.messages ?? null}
    />
  );
}
