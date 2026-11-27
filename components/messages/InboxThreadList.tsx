// components/messages/InboxThreadList.tsx
//
// Inbox rows: ONE row shape for the rail beside an open thread and for the full-width
// `/messages` list, read off Instagram's Direct list and Airbnb's Messages
// (Mobbin, 2026-11-28):
//
//   [visual 48]  Name  [status]                 13h
//                Last message…                    ●
//
//   - THE VISUAL SAYS WHAT KIND OF THREAD IT IS. A thread about a listing leads with the
//     card's photo and the member's avatar on its corner, as Airbnb leads with the stay;
//     a thread with no photo (a trade, a direct message) leads with the member's avatar.
//     The grey square with a handshake glyph that stood in for a missing photo is gone:
//     it was a placeholder pretending to be content.
//   - TWO LINES, NOT THREE. The clock moved from its own third line to the end of the
//     name line, so a row is 68px and the preview gets the full width beneath.
//   - ONE TYPE SIZE, TWO WEIGHTS. Name and preview are both `text-body` (the name was
//     16px beside a 14px preview and a 12px clock: three sizes in one row). Unread is
//     the weight, the ink colour and an iris dot, Instagram's three signals.
//   - NO RULES BETWEEN ROWS. Rows are inset tiles that tint on hover and when open, so
//     the list reads as one surface rather than a ruled table.
//
// A CONTRACT THREAD SAYS SO, AND SAYS WHAT STATE IT IS IN. A live $400 purchase and
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
import { Icon } from '@/components/ui/icon';
import { ArrowsLeftRightIcon } from '@/components/ui/icons';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MobileList } from '@/components/ui/mobile-list';
import { CashSaleStatusBadge } from '@/components/sales/CashSaleStatusBadge';
import { StorageImage } from '@/components/ui/storage-image';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import type { ConversationListEntry } from '@/lib/actions/messages';
import { cn } from '@/lib/utils';

function statusPill(c: ConversationListEntry) {
  if (c.sale) {
    if (c.sale.activeContractCount > 1) {
      return (
        <Badge variant="secondary" className="shrink-0">
          {c.sale.activeContractCount} active
        </Badge>
      );
    }
    // THE SHARED BADGE, not a hand-rolled pill. Thirteen statuses each with a chosen
    // label and tone already exist in one place; restating any of them here is how the
    // inbox and the contract room end up disagreeing about the same sale.
    return <CashSaleStatusBadge status={c.sale.status} className="shrink-0" />;
  }
  if (c.trade) {
    // No state: a list entry carries the trade's id and nothing else. "Trade" is
    // honest about what is known, and the contract room is one tap away. A KIND, not a
    // status, so it takes the swap glyph rather than a status dot.
    return (
      <Badge variant="secondary" className="shrink-0">
        <Icon icon={ArrowsLeftRightIcon} />
        Trade
      </Badge>
    );
  }
  return null;
}

/**
 * A row's second line. A thread with nothing said in it yet names the card it is about,
 * so two empty threads with the same member can still be told apart.
 */
function previewFor(c: ConversationListEntry): string {
  return c.lastMessage?.body ?? c.item?.title ?? 'No messages yet';
}

/**
 * "13h", not "13h ago". The row is a list of recent activity, so every figure in that
 * column is an age; the suffix cost a narrow rail about 28px a row for no information.
 */
function compactAge(label: string): string {
  if (label === 'just now') return 'now';
  return label.replace(/ ago$/, '');
}

/** The iris dot, with the count spoken. The weight change says "unread" to the eye. */
function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-iris" />
      <span className="sr-only">
        , {count} unread {count === 1 ? 'message' : 'messages'}
      </span>
    </>
  );
}

/**
 * The row's leading 48px: the listing's photo with the member on its corner, or the
 * member alone. The photo carries the card's name for anyone who cannot see it, because
 * the row names the person and the photo is the only thing that says which card.
 */
function ThreadVisual({ c, name }: { c: ConversationListEntry; name: string }) {
  const thumb = c.item ? itemImageUrl(c.item.imagePath) : null;
  if (!thumb) {
    return (
      <Avatar
        avatarPath={c.other.avatarPath}
        displayName={name}
        size="lg"
        className="size-12 text-body"
      />
    );
  }
  return (
    <span className="relative size-12 shrink-0">
      <StorageImage
        src={thumb}
        alt={c.item?.title ?? ''}
        width={48}
        height={48}
        // An inset hairline (`outline` with a negative offset is drawn OVER the image),
        // so a card photographed on white still has an edge on a white row.
        className="size-12 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-foreground/[0.08]"
        loading="lazy"
      />
      {/* `ring-card`: the white sticker edge Airbnb draws, so the avatar reads as
          sitting ON the photo rather than cut into it. */}
      <Avatar
        avatarPath={c.other.avatarPath}
        displayName={name}
        size="xs"
        className="absolute -bottom-1 -right-1 ring-2 ring-card"
      />
    </span>
  );
}

function ThreadRow({
  c,
  className,
  selected = false,
  current = false,
  onOpen,
}: {
  c: ConversationListEntry;
  className?: string;
  /**
   * Highlighted as the thread the pane beside the list is showing — or, for the moment
   * a click is in flight, the one it is about to show.
   */
  selected?: boolean;
  /** This thread IS the page: drawn as a focusable box rather than a link. */
  current?: boolean;
  /** Rail only. Called as a client-side navigation to this thread starts. */
  onOpen?: (conversationId: string) => void;
}) {
  const name = c.other.displayName?.trim() || 'NoDitto member';
  const preview = previewFor(c);
  const age = compactAge(formatRelativeTime(c.lastMessage?.createdAt ?? c.lastMessageAt));
  const unread = c.unreadCount > 0;

  return (
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
    //
    // HIGHLIGHT AND LINK-NESS ARE SEPARATE. A click in the rail highlights the row it
    // opens immediately, before the router has committed it, and that row has to stay a
    // LINK until then: turning it into a box mid-flight would unmount the very link whose
    // navigation is running. The row you are leaving becomes a link again in the same
    // render, so a second thought is one click away.
    <RowShell
      href={`/messages/${c.id}`}
      current={current}
      onNavigate={onOpen ? () => onOpen(c.id) : undefined}
      className={cn(
        // `px-snug` inside the list's `p-snug`: the content lands 16px in, on the same line as
        // the pane bar's `px-group` title.
        'flex min-h-11 items-center gap-cozy rounded-xl px-snug py-2.5 outline-none transition-colors',
        // An inset ring, so it is not clipped by the pane's scroll box.
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        // A tint of the INK, the same `foreground/6` the workspace rail's current item
        // wears, so "this is where you are" reads one way across both. No iris bar here:
        // on an inset tile the fill is the whole statement.
        selected ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.035]',
        className,
      )}
    >
      <ThreadVisual c={c} name={name} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-snug">
          <p
            className={cn(
              'truncate text-body text-foreground',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {name}
          </p>
          {statusPill(c)}
          {/* `suppressHydrationWarning`: in the rail this row is rendered on the server
              and then hydrated, and a relative time can tick over ("4m" -> "5m") in
              between. The rail re-renders it on its own clock (`InboxRail`). */}
          {/* Always muted: the name, the preview and the dot already say "unread", and a
              bold clock beside a bold name was a fourth signal for the same fact. */}
          <span
            className="ml-auto shrink-0 pl-tight text-meta tabular-nums text-muted-foreground"
            suppressHydrationWarning
          >
            {age}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-snug">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-body',
              unread ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {preview}
          </p>
          <UnreadDot count={c.unreadCount} />
        </div>
      </div>
    </RowShell>
  );
}

/**
 * A row's outer element: a link to the thread, or — when that thread is the one already
 * open beside the list — a plain focusable box that goes nowhere.
 *
 * This module carries no `'use client'` and stays server-renderable: the full-width
 * `/messages` list renders it on the server as static links. The rail is the one caller
 * that needs the click, and it renders this list from a client component (`InboxRail`),
 * which is what lets it pass `onNavigate` at all.
 *
 * `onNavigate`, not `onClick`: it fires only for a client-side navigation, so a
 * Ctrl/Cmd-click into a new tab does not mark a thread as being opened HERE.
 *
 * `scroll={false}` with it. A switch between threads replaces one pane, and Next's
 * default scroll-and-focus handling has nothing useful to do — it would at best move
 * focus off the row a keyboard user is working down the list from.
 */
function RowShell({
  href,
  current,
  onNavigate,
  className,
  children,
}: {
  href: string;
  current: boolean;
  onNavigate?: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (current) {
    return (
      <div aria-current="page" tabIndex={0} className={className}>
        {children}
      </div>
    );
  }
  return (
    <Link
      href={href}
      transitionTypes={['nav-forward']}
      onNavigate={onNavigate}
      scroll={onNavigate ? false : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

export function InboxThreadList({
  conversations,
  variant = 'page',
  activeId = null,
  pendingId = null,
  onOpen,
}: {
  conversations: ConversationListEntry[];
  /**
   * `page` — the full-width `/messages` route: on a phone the rows sit on the page; from
   * `md` they sit inside one grouped card.
   *
   * `rail` — the 21rem list pane beside an open thread (`InboxTwoPane`). No card chrome:
   * the pane is already a bordered surface, and a card inside it would be a second
   * border a few pixels in.
   *
   * Both draw the same row. It used to be two rows (a compact one and a wide desktop one
   * with the thumbnail leading and the avatar inline), which is how the same thread
   * looked different depending on which page listed it.
   */
  variant?: 'page' | 'rail';
  /** In the rail, the conversation the router has committed — the one in the URL. */
  activeId?: string | null;
  /** In the rail, a conversation a click is opening and the router has not yet committed. */
  pendingId?: string | null;
  /** In the rail, called as a client-side navigation to a thread starts. */
  onOpen?: (conversationId: string) => void;
}) {
  if (variant === 'rail') {
    // The highlight follows the click; the "you are here" box follows the router.
    const shown = pendingId ?? activeId;
    return (
      <ul role="list" aria-label="Conversations" className="flex flex-col gap-px p-snug">
        {conversations.map((c) => (
          <li key={c.id}>
            <ThreadRow
              c={c}
              selected={c.id === shown}
              current={c.id === activeId && pendingId === null}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    // `-mx-snug` on a phone pulls the tiles' own inset into the page gutter, so the
    // avatars line up with the "Inbox" heading above rather than 8px inside it.
    <MobileList
      label="Conversations"
      variant="sheet"
      className="flex flex-col gap-px max-md:-mx-snug max-md:divide-y-0 md:divide-y-0 md:p-snug"
    >
      {conversations.map((c) => (
        <li key={c.id}>
          <ThreadRow c={c} />
        </li>
      ))}
    </MobileList>
  );
}
