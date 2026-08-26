// app/messages/page.tsx
//
// The Messages inbox (Phase 2). A Server Component that requires an
// authenticated user and lists their conversations (newest activity first) via
// the `listMyConversations` server action. Phone rows match the Xianyu 消息
// list; desktop keeps the grouped market card.

import { redirect } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { listMyConversations } from '@/lib/actions/messages';
import { EmptyState } from '@/components/ui/empty-state';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';
import { InboxThreadList } from '@/components/messages/InboxThreadList';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the signed-in user's session + live conversation state, so it must
// render dynamically (never statically prerendered).
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Messages · NoDitto',
  description: 'Your buyer and seller conversations.',
};

export default async function MessagesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/messages');
  }

  const result = await listMyConversations();
  const conversations = result.ok ? result.conversations : [];

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const countLabel = result.ok ? (
    <>
      {conversations.length === 1
        ? '1 conversation'
        : `${conversations.length} conversations`}
      {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
    </>
  ) : (
    'Your buyer and seller conversations.'
  );

  return (
    <MarketplaceShell title="Messages">
      <div aria-live="polite" className="sr-only">
        {result.ok ? countLabel : null}
      </div>
      <SectionHeader title="Inbox" description={countLabel} />
      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="conversations" />
        </div>
      ) : conversations.length === 0 ? (
        <>
          <p className="mt-3 text-body text-muted-foreground md:hidden">
            Messages with buyers and sellers will appear here.
          </p>
          <EmptyState
            icon={<MessageSquare className="size-6" aria-hidden="true" />}
            title="No Conversations Yet"
            description="Messages with buyers and sellers will appear here. Browse the marketplace to start a conversation."
            action={{ label: 'Browse Marketplace', href: '/listings' }}
            help={{ label: 'How holds and disputes work', href: '/help#holds' }}
            compact
            hideActionOnMobile
            className="hidden md:flex"
          />
        </>
      ) : (
        <InboxThreadList conversations={conversations} />
      )}
    </MarketplaceShell>
  );
}
