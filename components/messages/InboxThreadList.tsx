// components/messages/InboxThreadList.tsx
//
// Inbox rows. Phone matches the Xianyu 消息 list: page is the surface, circular
// avatar with unread on the shoulder, title + status pill, preview, timestamp
// under the preview, listing thumb on the far right. Desktop keeps the existing
// grouped card (thumb leading, time on the title row, unread badge).
//
// A CONTRACT THREAD NOW SAYS SO, AND SAYS WHAT STATE IT IS IN. A live $400 purchase and
// someone asking whether a card is still available were the same row: a name, a preview
// and a thumbnail. The badge comes from `CASH_SALE_STATUS_MAP` through the same
// `CashSaleStatusBadge` the contract room and the Sales list render, so a thread cannot
// describe a contract differently from the contract itself.
//
// A DISPUTE IS A STATE OF THE CONTRACT THREAD, NOT A THREAD OF ITS OWN. `entry.sale`
// is the contract thread, found from `cash_sales.conversation_id`, and its status
// (`DISPUTED` included) is what the pill shows. The separate "arbitration chat" row
// that 0019 used to add — same two people, an alert triangle for a thumbnail — was
// retired in 0115.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandshakeIcon, MessageSquareIcon } from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MobileList } from '@/components/ui/mobile-list';
import { CashSaleStatusBadge } from '@/components/sales/CashSaleStatusBadge';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import type { ConversationListEntry } from '@/lib/actions/messages';
import { cn } from '@/lib/utils';

function statusPill(c: ConversationListEntry) {
  if (c.sale) {
    if (c.sale.activeContractCount > 1) {
      return (
        <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-meta font-medium text-foreground">
          {c.sale.activeContractCount} active
        </span>
      );
    }
    // THE SHARED BADGE, not a hand-rolled pill. Thirteen statuses each with a chosen
    // label and tone already exist in one place; restating any of them here is how the
    // inbox and the contract room end up disagreeing about the same sale.
    return <CashSaleStatusBadge status={c.sale.status} className="shrink-0" />;
  }
  if (c.trade) {
    // No state: a list entry carries the trade's id and nothing else. "Trade" is
    // honest about what is known, and the contract room is one tap away.
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
        count === 1 ? 'size-2.5' : 'min-h-4 min-w-4 px-tight text-meta font-semibold leading-none',
      )}
      aria-label={`${count} unread messages`}
    >
      {count === 1 ? null : count > 99 ? '99+' : count}
    </span>
  );
}

function MobileThreadRow({
  c,
  className,
  active = false,
}: {
  c: ConversationListEntry;
  /** Inset for the rail pane, which has no padding of its own to lend. */
  className?: string;
  /** This is the conversation currently open in the pane beside the list. */
  active?: boolean;
}) {
  const name = c.other.displayName?.trim() || 'NoDitto member';
  const thumb = c.item ? itemImageUrl(c.item.imagePath) : null;
  const preview = c.lastMessage?.body ?? 'No messages yet';
  const time = formatRelativeTime(c.lastMessage?.createdAt ?? c.lastMessageAt);
  const unread = c.unreadCount > 0;

  return (
    // `items-center`, NOT `items-start`. The text column is three lines — name,
    // preview, timestamp — so at roughly 60px it is taller than either the 48px avatar
    // or the 44px thumbnail beside it. Top-aligning all three left both squares riding
    // high with a dozen pixels of dead space underneath, which is what read as
    // uncentred. Centring them also removes the `mt-0.5` nudges that were compensating
    // for it in two places and would have had to be retuned every time a line was
    // added to the middle column.
    // THE OPEN THREAD IS NOT A LINK. Clicking the row you are already reading used to
    // navigate to the route you are already on, which Next answers by refetching the
    // segment and remounting the thread — the history entry is identical, so it reads as
    // the page reloading itself for no reason, and it drops you back to the bottom of the
    // log. There is nothing to activate, so it is not a control.
    //
    // Still `aria-current="page"` and still focusable: in the rail the highlight is the
    // only thing saying which thread the pane on the right is showing, and a keyboard
    // user tabbing the list should not have the current row silently vanish from the
    // order. `RowShell` is `div`/`Link` and nothing else changes between the two.
    <RowShell
      href={`/messages/${c.id}`}
      active={active}
      className={cn(
        'relative flex min-h-11 items-center gap-cozy py-3.5 border border-transparent focus:outline-none focus-visible:border-iris',
        // CURRENT READS THE SAME WAY IT DOES IN THE WORKSPACE RAIL, and deliberately
        // so — this row and the rail's own current item are the same statement. That
        // means a NEUTRAL fill plus an iris bar, copied from `MarketplaceNav`, not
        // `bg-muted`: muted is violet-tinted (`283 34% 96%`), so the open thread wore a
        // lavender wash and was the one coloured thing in the list, which reads as
        // decoration rather than as position.
        active
          ? 'bg-foreground/[0.06] before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-iris before:content-[""]'
          : 'transition-colors hover:bg-muted/60',
        className,
      )}
    >
      <span className="relative shrink-0">
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
          className="size-11 shrink-0 rounded-md object-cover"
        />
      ) : c.trade ? (
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <HugeiconsIcon icon={HandshakeIcon} className="size-5" />
        </span>
      ) : null}
    </RowShell>
  );
}

/**
 * A row's outer element: a link to the thread, or — when that thread is the one already
 * open beside the list — a plain focusable box that goes nowhere.
 *
 * Server-renderable on purpose. Intercepting the click on the client would need this
 * module to become a client component, and the whole list is static markup; there is no
 * state here worth shipping to the browser to answer a question the server already knows
 * the answer to.
 */
function RowShell({
  href,
  active,
  className,
  children,
}: {
  href: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (active) {
    return (
      <div aria-current="page" tabIndex={0} className={className}>
        {children}
      </div>
    );
  }
  return (
    <Link href={href} transitionTypes={['nav-forward']} className={className}>
      {children}
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
      className="flex items-center gap-cozy p-group transition-colors hover:bg-muted/60 border border-transparent focus:outline-none focus-visible:border-iris"
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
          className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {c.trade ? (
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
        <div className="flex items-center gap-snug">
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
  variant = 'page',
  activeId = null,
}: {
  conversations: ConversationListEntry[];
  /**
   * `page` — the full-width `/messages` route: compact rows on a phone, the wide row
   * from `md`, wrapped in the grouped market card.
   *
   * `rail` — the 21rem list pane beside an open thread (`InboxTwoPane`). Draws the
   * COMPACT row at every width, because the wide row puts a 48px thumbnail, an avatar,
   * a name, a status pill, a clock and an unread badge on one line and none of that
   * survives the narrower column. No card chrome either: the pane is already a bordered
   * surface, and a card inside it would be a second border a few pixels in.
   */
  variant?: 'page' | 'rail';
  /** In the rail, which conversation the pane on the right is showing. */
  activeId?: string | null;
}) {
  if (variant === 'rail') {
    return (
      <ul role="list" aria-label="Conversations" className="divide-y divide-border">
        {conversations.map((c) => (
          <li key={c.id}>
            <MobileThreadRow c={c} className="px-cozy" active={c.id === activeId} />
          </li>
        ))}
      </ul>
    );
  }

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
