// app/(workspace)/messages/(thread)/[id]/page.tsx
//
// A single conversation thread. A Server Component that:
//   1. Requires an authenticated user (unauthenticated -> sign-in).
//   2. Loads the conversation via `getConversation`, which enforces the
//      two-participant access rule under RLS — a non-participant (or missing
//      conversation) yields a 404.
//   3. Renders the live client <ChatThread/>, which subscribes to realtime
//      message changes, drives the composer, and marks the conversation read on
//      mount.
//
// THE THREAD AND NOTHING ELSE. The shell and the inbox pane belong to the route group's
// layout (`../layout.tsx`), which a thread-to-thread click does not re-render, so this
// page is the whole of the server work a switch costs. It used to draw the shell and
// re-run the full inbox query as well, on every click.

import { notFound, redirect } from 'next/navigation';

import { ChatThread } from '@/components/messages/ChatThread';
import { getConversation } from '@/lib/actions/messages';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

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

  // In parallel, and still one auth round trip: `getConversation` resolves the caller
  // through the same request-cached read. This used to call `auth.getUser()` directly,
  // which bypassed that cache and cost a second trip to the auth server per click.
  const [user, result] = await Promise.all([
    getCachedAuthUser(),
    getConversation(conversationId),
  ]);
  if (!user) {
    redirect(`/sign-in?redirectTo=/messages/${conversationId}`);
  }
  if (!result.ok) {
    // not-found / not-participant / unauthenticated all resolve to a 404 so we
    // never disclose the existence of a conversation to a non-participant.
    notFound();
  }

  const { conversation, other, item, trade, sale, shipment, messages } = result.data;

  return (
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
  );
}
