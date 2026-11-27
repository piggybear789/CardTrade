// app/messages/page.tsx
//
// The Messages inbox (Phase 2). A Server Component that requires an
// authenticated user and lists their conversations (newest activity first) via
// the `listMyConversations` server action. Phone rows match the Xianyu 消息
// list; desktop keeps the grouped market card.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { ChatsCircleIcon } from '@/components/ui/icons';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { listMyConversations } from '@/lib/actions/messages';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';
import { InboxThreadList } from '@/components/messages/InboxThreadList';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Messages · NoDitto',
  description: 'Your buyer and seller conversations.',
};

/** Conversations per inbox page. */
const PAGE_SIZE = 20;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const rawPage = (await searchParams).page;
  // Together: the list resolves the caller through the same request-cached read.
  const [user, result] = await Promise.all([getCachedAuthUser(), listMyConversations()]);
  if (!user) {
    redirect('/sign-in?redirectTo=/messages');
  }
  const conversations = result.ok ? result.conversations : [];

  // PAGINATED, not one endless list: the whole list is still read (unread totals and
  // the count need it), and only this page's slice is drawn.
  const pageCount = Math.max(1, Math.ceil(conversations.length / PAGE_SIZE));
  const requested = Number.parseInt(Array.isArray(rawPage) ? rawPage[0] : rawPage ?? '1', 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1;
  const pageItems = conversations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        // `fill`, as the other inboxes (Activity, Saved, Sales) draw theirs: this one was
        // the only empty list on a phone drawn as a left-aligned block at the top.
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <EmptyState
            icon={<Icon icon={ChatsCircleIcon} className="size-6" aria-hidden="true" />}
            title="No conversations yet"
            description="Messages with buyers and sellers appear here. Ask a seller about any listing to start one."
            action={{ label: 'Browse the marketplace', href: '/', variant: 'outline' }}
            fill
          />
        </div>
      ) : (
        <>
          <InboxThreadList conversations={pageItems} />
          {pageCount > 1 ? (
            <nav aria-label="Inbox pages" className="mt-group flex items-center justify-between gap-cozy">
              <PageLink page={page - 1} disabled={page <= 1}>
                Previous
              </PageLink>
              <p className="text-meta tabular-nums text-muted-foreground">
                Page {page} of {pageCount}
              </p>
              <PageLink page={page + 1} disabled={page >= pageCount}>
                Next
              </PageLink>
            </nav>
          ) : null}
        </>
      )}
    </MarketplaceShell>
  );
}

/** Previous / Next. Disabled stays rendered so the bar never shifts. */
function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={page === 1 ? '/messages' : `/messages?page=${page}`}>{children}</Link>
    </Button>
  );
}
