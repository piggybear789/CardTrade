// app/messages/[id]/page.tsx
//
// A single conversation thread (Phase 2). A Server Component that:
//   1. Requires an authenticated user (unauthenticated -> sign-in).
//   2. Loads the conversation via `getConversation`, which enforces the
//      two-participant access rule under RLS — a non-participant (or missing
//      conversation) yields a 404.
//   3. Renders the live client <ChatThread/>, which subscribes to realtime
//      message changes, drives the composer, and marks the conversation read on
//      mount.

import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getConversation, listMyConversations } from '@/lib/actions/messages';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { ChatThread } from '@/components/messages/ChatThread';
import { InboxThreadList } from '@/components/messages/InboxThreadList';
import { InboxTwoPane } from '@/components/messages/InboxTwoPane';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Conversation · NoDitto',
  description: 'Your conversation with another NoDitto member.',
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: conversationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=/messages/${conversationId}`);
  }

  const result = await getConversation(conversationId);
  if (!result.ok) {
    // not-found / not-participant / unauthenticated all resolve to a 404 so we
    // never disclose the existence of a conversation to a non-participant.
    notFound();
  }

  const { conversation, other, item, trade, sale, shipment, messages } = result.data;

  // The list beside the thread, from `lg` (see `InboxTwoPane`). Fetched here rather than
  // in a shared segment layout: the list holds no realtime subscription and no client
  // state — it is a server-rendered set of links — so a layout would buy only a saved
  // refetch, at the cost of a route-aware pane that has to hide itself on `/messages`.
  //
  // A FAILED LIST MUST NOT COST THE READER THEIR THREAD. This is secondary navigation for
  // a page whose actual subject already loaded, so an error degrades to no pane.
  const inbox = await listMyConversations();
  const conversations = inbox.ok ? inbox.conversations : [];
  const unread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    // `fill`: the two-pane inbox caps its own content — a fixed-width list pane and a
    // 44rem reading column — so the shell's 90rem cap only left dead space beside it.
    <MarketplaceShell
      title="Messages"
      flush
      fill
      contentOwnsBottomPadding
    >
      <InboxTwoPane
        countLabel={unread > 0 ? `${unread} unread` : null}
        list={
          <InboxThreadList
            conversations={conversations}
            variant="rail"
            activeId={conversation.id}
          />
        }
        detail={
          <ChatThread
            conversationId={conversation.id}
            currentUserId={user.id}
            otherName={other.displayName}
            otherAvatarPath={other.avatarPath}
            item={item}
            trade={trade}
            sale={sale}
            shipment={shipment}
            initialMessages={messages}
          />
        }
      />
    </MarketplaceShell>
  );
}
