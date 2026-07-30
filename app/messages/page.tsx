// app/messages/page.tsx
//
// The Messages inbox (Phase 2). A Server Component that requires an
// authenticated user and lists their conversations (newest activity first) via
// the `listMyConversations` server action. Each row links to the conversation
// thread and shows the other participant, the related item thumbnail + title
// (if any), the last-message preview with relative time, and an unread badge.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Handshake, MessageSquare } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { listMyConversations } from '@/lib/actions/messages';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';

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

  return (
    <MarketplaceShell title="Messages">
      <div aria-live="polite">
        <SectionHeader
          title="Inbox"
          description={
            <>
              {conversations.length === 1
                ? '1 conversation'
                : `${conversations.length} conversations`}
              {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
            </>
          }
        />
      </div>

      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="conversations" />
        </div>
      ) : null}

      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-6" aria-hidden="true" />}
          title="No Conversations Yet"
          description="Messages with buyers and sellers will appear here. Browse the marketplace to start a conversation."
          action={{ label: 'Browse Marketplace', href: '/listings' }}
          compact
        />
      ) : (
        <ul
          className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card shadow-market"
          aria-label="Conversations"
        >
          {conversations.map((c) => {
            const name = c.other.displayName?.trim() || 'NoDitto member';
            const thumb = c.item ? itemImageUrl(c.item.imagePath) : null;
            const preview = c.lastMessage?.body ?? 'No messages yet';
            const time = formatRelativeTime(
              c.lastMessage?.createdAt ?? c.lastMessageAt,
            );
            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      width={96}
                      height={96}
                      className="size-12 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      className={`flex size-12 shrink-0 items-center justify-center rounded-md ${c.dispute ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                      aria-hidden="true"
                    >
                      {c.dispute ? (
                        <AlertTriangle className="size-5" />
                      ) : c.deal || c.trade ? (
                        <Handshake className="size-5" />
                      ) : (
                        <MessageSquare className="size-5" />
                      )}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{name}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {time}
                      </span>
                    </div>
                    {c.dispute ? (
                      <p className="truncate text-xs font-medium text-destructive">
                        Dispute: {c.dispute.itemTitle}
                      </p>
                    ) : c.deal ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Private deal: {c.deal.title}
                      </p>
                    ) : c.trade ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Trade
                      </p>
                    ) : c.item ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Re: {c.item.title}
                      </p>
                    ) : null}
                    <p
                      className={
                        c.unreadCount > 0
                          ? 'truncate text-sm font-medium text-foreground'
                          : 'truncate text-sm text-muted-foreground'
                      }
                    >
                      {preview}
                    </p>
                  </div>

                  {c.unreadCount > 0 ? (
                    <Badge
                      className="shrink-0"
                      aria-label={`${c.unreadCount} unread messages`}
                    >
                      {c.unreadCount}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </MarketplaceShell>
  );
}
