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
import { getConversation } from '@/lib/actions/messages';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { ChatThread } from '@/components/messages/ChatThread';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the authenticated user's session, so it must render dynamically.
export const dynamic = 'force-dynamic';

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

  const { conversation, other, item, trade } = result.data;

  return (
    <MarketplaceShell title="Messages" flush>
      <ChatThread
        conversationId={conversation.id}
        currentUserId={user.id}
        otherName={other.displayName}
        otherAvatarPath={other.avatarPath}
        item={item}
        trade={trade}
      />
    </MarketplaceShell>
  );
}
