// components/messages/InboxThreadList.tsx
//
// Inbox rows. Phone matches the Xianyu 消息 list: page is the surface, circular
// avatar with unread on the shoulder, title + status pill, preview, timestamp
// under the preview, listing thumb on the far right. Desktop keeps the existing
// grouped card (thumb leading, time on the title row, unread badge).

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandshakeIcon, MessageSquareIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MobileList } from '@/components/ui/mobile-list';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import type { ConversationListEntry } from '@/lib/actions/messages';
import { cn } from '@/lib/utils';

function statusPill(c: ConversationListEntry) {
  if (c.dispute) {
    return (
      // "Disputed", matching `CASH_SALE_STATUS_MAP` — the state of the contract,
      // not the name of a noun. The room, the badge and the thread now agree.
      <span className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-meta font-medium text-destructive">
        Disputed
      </span>
    );
  }
  if (c.trade) {
    return (
      <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
        Trade
      </span>
    );
  }
  return null;
}

function UnreadMark({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'absolute -right-0.5 -top-0.5 grid place-items-center rounded-full bg-destructive text-destructive-foreground',
        count === 1 ? 'size-2.5' : 'min-h-4 min-w-4 px-1 text-[10px] font-semibold leading-none',
      )}
      aria-label={`${count} unread messages`}
    >
      {count === 1 ? null : count > 99 ? '99+' : count}
    </span>
  );
}

function MobileThreadRow({ c }: { c: ConversationListEntry }) {
  const name = c.other.displayName?.trim() || 'NoDitto member';
  const thumb = c.item ? itemImageUrl(c.item.imagePath) : null;
  const preview = c.lastMessage?.body ?? 'No messages yet';
  const time = formatRelativeTime(c.lastMessage?.createdAt ?? c.lastMessageAt);
  const unread = c.unreadCount > 0;

  return (
    <Link
      href={`/messages/${c.id}`}
      transitionTypes={['nav-forward']}
      className="flex min-h-11 items-start gap-3 py-3.5 border border-transparent focus:outline-none focus-visible:border-iris"
    >
      <span className="relative mt-0.5 shrink-0">
        <Avatar
          avatarPath={c.other.avatarPath}
          displayName={name}
          size="lg"
          className="size-12 text-body"
        />
        <UnreadMark count={c.unreadCount} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p
            className={cn(
              'truncate text-lead',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {name}
          </p>
          {statusPill(c)}
        </div>
        <p
          className={cn(
            'mt-0.5 truncate text-body',
            unread ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {preview}
        </p>
        <p className="mt-0.5 text-meta text-muted-foreground">{time}</p>
      </div>

      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={c.item?.title ?? ''}
          width={88}
          height={88}
          className="mt-0.5 size-11 shrink-0 rounded-md object-cover"
        />
      ) : c.dispute || c.trade ? (
        <span
          className={cn(
            'mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-md bg-muted',
            c.dispute ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-hidden
        >
          {c.dispute ? (
            <HugeiconsIcon icon={TriangleAlertIcon} className="size-5" />
          ) : (
            <HugeiconsIcon icon={HandshakeIcon} className="size-5" />
          )}
        </span>
      ) : null}
    </Link>
  );
}

function DesktopThreadRow({ c }: { c: ConversationListEntry }) {
  const name = c.other.displayName?.trim() || 'NoDitto member';
  const thumb = c.item ? itemImageUrl(c.item.imagePath) : null;
  const preview = c.lastMessage?.body ?? 'No messages yet';
  const time = formatRelativeTime(c.lastMessage?.createdAt ?? c.lastMessageAt);

  return (
    <Link
      href={`/messages/${c.id}`}
      transitionTypes={['nav-forward']}
      className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/60 border border-transparent focus:outline-none focus-visible:border-iris"
    >
      {thumb ? (
        // NOT decorative any more. With the item title dropped from the row, the
        // thumbnail is the only thing that says which card the thread is about,
        // so it has to carry that name for anyone who cannot see it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={c.item?.title ?? ''}
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
            <HugeiconsIcon icon={TriangleAlertIcon} className="size-5" />
          ) : c.trade ? (
            <HugeiconsIcon icon={HandshakeIcon} className="size-5" />
          ) : (
            <HugeiconsIcon icon={MessageSquareIcon} className="size-5" />
          )}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* ONE 24px LINE. The avatar is `size-6` and `text-lead` resolves to a
            24px line box, so with everything at `items-center` the glyphs, the
            name, the pill and the clock share one optical centre. The previous
            row mixed `text-lead` with `text-body` and wrapped, which is what put
            three different baselines on what should read as a single line.

            The item title is gone on purpose: the thumbnail to the left already
            says which card this is, and spelling it out cost the row its whole
            width and forced the wrap. State is a pill now, not a sentence. */}
        <div className="flex items-center gap-2">
          <Avatar avatarPath={c.other.avatarPath} displayName={name} size="xs" />
          <span className="truncate text-lead font-medium">{name}</span>
          {statusPill(c)}
          <span className="ml-auto shrink-0 text-meta text-muted-foreground">
            {time}
          </span>
        </div>
        <p
          className={
            c.unreadCount > 0
              ? 'mt-0.5 truncate text-body font-medium text-foreground'
              : 'mt-0.5 truncate text-body text-muted-foreground'
          }
        >
          {preview}
        </p>
      </div>

      {c.unreadCount > 0 ? (
        <Badge className="shrink-0" aria-label={`${c.unreadCount} unread messages`}>
          {c.unreadCount}
        </Badge>
      ) : null}
    </Link>
  );
}

export function InboxThreadList({
  conversations,
}: {
  conversations: ConversationListEntry[];
}) {
  return (
    <MobileList label="Conversations" variant="sheet">
      {conversations.map((c) => (
        <li key={c.id}>
          <div className="md:hidden">
            <MobileThreadRow c={c} />
          </div>
          <div className="hidden md:block">
            <DesktopThreadRow c={c} />
          </div>
        </li>
      ))}
    </MobileList>
  );
}
