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
    <MarketplaceShell title="Messages">
      {/* The ONE thing that makes a flex+overflow scroll work: a DEFINITE HEIGHT
          somewhere in the ancestor chain. Without it, flex-1 + overflow-y-auto on any
          descendant just grows the page — there is nothing to overflow against.

          The shell's flex chain never terminates at a definite height: it is flex-1 all
          the way up with no h-screen or h-[100dvh] ancestor. Three attempts to fix this
          at the component level failed for this exact reason.

          So the constraint lives HERE, at the page level, using a viewport unit that is
          always definite. The subtraction accounts for the nav bar (4rem), its border
          (1px), the shell padding (1.25rem top), and the mobile tab bar's safe area.
          On desktop the py-7 adds more, so that breakpoint uses a larger deduction. */}
      <div className="flex h-[calc(100dvh-5.25rem-1px-env(safe-area-inset-bottom))] flex-col overflow-hidden lg:h-[calc(100dvh-4rem-1px-3.5rem)]">
        <ChatThread
          conversationId={conversation.id}
          currentUserId={user.id}
          otherName={other.displayName}
          otherAvatarPath={other.avatarPath}
          item={item}
          trade={trade}
        />
      </div>
    </MarketplaceShell>
  );
}
