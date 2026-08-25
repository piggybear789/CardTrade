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
import { Avatar } from '@/components/ui/avatar';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';

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

  return (
    <MarketplaceShell title="Messages">
      <div aria-live="polite">
        <SectionHeader
          title="Inbox"
          description={
            result.ok ? (
              <>
                {conversations.length === 1
                  ? '1 conversation'
                  : `${conversations.length} conversations`}
                {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
              </>
            ) : (
              'Your buyer and seller conversations.'
            )
          }
        />
      </div>
      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="conversations" />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-6" aria-hidden="true" />}
          title="No Conversations Yet"
          description="Messages with buyers and sellers will appear here. Browse the marketplace to start a conversation."
          action={{ label: 'Browse Marketplace', href: '/listings' }}
          help={{ label: 'How holds and disputes work', href: '/help#holds' }}
          compact
        />
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-market"
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
                  transitionTypes={['nav-forward']}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/60 border border-transparent focus:outline-none focus-visible:border-gold/40"
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
                      ) : c.trade ? (
                        <Handshake className="size-5" />
                      ) : (
                        <MessageSquare className="size-5" />
                      )}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      {/* Beside the NAME, not in the leading square — that square is
                          the item thumbnail, which is what a member recognises a
                          marketplace conversation by.
                          The SUBJECT sits inline after the name rather than on its own
                          line below it: the name and what it is about are one fact, and
                          stacking them pushed the message preview down and made every row
                          taller for no gain. The name keeps priority when space is tight —
                          it truncates last, because two conversations about one item are
                          told apart by who they are with. */}
                      <p className="flex min-w-0 flex-wrap items-center gap-x-tight gap-y-0.5 text-lead font-medium">
                        <Avatar
                          avatarPath={c.other.avatarPath}
                          displayName={name}
                          size="xs"
                        />
                        <span className="truncate">{name}</span>
                        {c.dispute ? (
                          <span className="truncate text-body font-medium text-destructive">
                            Dispute: {c.dispute.itemTitle}
                          </span>
                        ) : c.trade ? (
                          <span className="truncate text-meta font-normal text-muted-foreground">
                            Trade
                          </span>
                        ) : c.item ? (
                          <span className="truncate text-body font-normal text-muted-foreground">
                            Re: {c.item.title}
                          </span>
                        ) : null}
                      </p>
                      <span className="shrink-0 text-meta text-muted-foreground">
                        {time}
                      </span>
                    </div>
                    <p
                      className={
                        c.unreadCount > 0
                          ? 'truncate text-body font-medium text-foreground'
                          : 'truncate text-body text-muted-foreground'
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
