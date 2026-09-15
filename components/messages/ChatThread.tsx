'use client';

// components/messages/ChatThread.tsx
//
// The live conversation view. Renders one subject bar (back, the item or the
// person, and the single link out to the listing or contract), a grouped
// realtime message list, and a composer that sends text plus one photo or PDF.
//
// Realtime message state comes from `useConversationRealtime`; the composer
// optimistically relies on the realtime INSERT to append the sent message. The
// thread auto-scrolls to the newest message and marks the conversation read on
// mount (and whenever new inbound messages arrive).

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import {
  markConversationRead,
  type ConversationItemSummary,
  type ConversationSaleSummary,
  type ConversationShipment,
} from '@/lib/actions/messages';
import { formatAud, itemImageUrl } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { CASH_SALE_STATUS_MAP } from '@/components/sales/CashSaleStatusBadge';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { MESSAGE_COLUMN, MessageLog } from '@/components/messages/MessageLog';
import { cn } from '@/lib/utils';

export interface ChatThreadProps {
  /** The conversation being viewed. */
  conversationId: string;
  /** The signed-in viewer's user id (to align/label their own messages). */
  currentUserId: string;
  /** Display name of the other participant (falls back to a generic label). */
  otherName: string | null;
  /**
   * The other participant's avatar object path, or null. A PATH, not a URL.
   * Optional: without it the header and incoming messages show initials, which is
   * the correct fallback rather than a gap.
   */
  otherAvatarPath?: string | null;
  /** Optional item context this conversation is about. */
  item: ConversationItemSummary | null;
  /** Set when this thread belongs to a 2-way trade's contract room. */
  trade?: { id: string } | null;
  /** Set when this thread belongs to a cash sale. */
  sale?: ConversationSaleSummary | null;
  /** Carrier details, so the shipped milestone can link out to tracking. */
  shipment?: ConversationShipment | null;
}

export function ChatThread({
  conversationId,
  currentUserId,
  otherName,
  otherAvatarPath = null,
  item,
  trade = null,
  sale = null,
  shipment = null,
}: ChatThreadProps) {
  const { messages, connectionStatus, addOptimistic, settleOptimistic } =
    useConversationRealtime(conversationId);

  const logRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const didPositionRef = useRef(false);
  const displayName = otherName?.trim() || 'NoDitto member';
  const itemThumb = item ? itemImageUrl(item.imagePath) : null;

  // The bar carries ONE subject. With an item that is the item, and the person
  // drops to the subline; without one the person is the subject outright. Two
  // titles and two images in a 56px bar is what made the old one need 150px.
  const subject = Boolean(item || trade || sale);
  const title = item ? item.title : trade ? 'Trade' : displayName;
  const price = item?.priceCents != null ? formatAud(item.priceCents) : null;

  // THE CONTRACT'S STATUS, NOT THE LISTING'S, whenever there is a contract.
  // A finished purchase used to read "Sold", which is a true statement about
  // the item and says nothing about whether the money settled — the one fact
  // the buyer is in this thread to check. `CASH_SALE_STATUS_MAP` is the single
  // place those labels are worded, so the thread and the room agree.
  //
  // The item fallback is cased here rather than with `capitalize`, which would
  // also re-case the member's own name further along the same line.
  const status = sale
    ? (CASH_SALE_STATUS_MAP[sale.status]?.label ?? null)
    : item?.status && item.status !== 'AVAILABLE'
      ? item.status.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
      : null;
  const offline = connectionStatus === 'error';
  const meta = [status, subject ? displayName : null].filter(Boolean).join(' · ');

  // THE DOCK, and it is the same component the contract room docks below its
  // own log — this thread and that panel are one surface with two entry points,
  // so "where do I act" has to answer in the same place and the same shape.
  //
  // What it CANNOT be is the room's live step. That is derived from the whole
  // contract record plus the viewer's role and facts, and the inbox loads
  // neither: a thread knows a trade's id and a sale's id and status, nothing
  // more. Deriving steps here would mean a second copy of the room's state
  // machine drifting against the first. So the dock states where the contract
  // stands and hands off; the controls that mutate it stay in the one place
  // that owns them.
  //
  // A live or finished contract belongs to its room; the listing is only the
  // right destination when there is no contract yet, and on a completed sale it
  // is actively the wrong one.
  const dock: {
    href: string;
    label: string;
    /** False while this is still only a conversation about a listing. */
    underContract: boolean;
  } | null = trade
    ? { href: `/trades/${trade.id}`, label: 'Open contract', underContract: true }
    : sale
      ? { href: `/sales/${sale.id}`, label: 'Open contract', underContract: true }
      : item
        ? {
            href: `/listings/${item.id}`,
            label: 'View listing',
            underContract: false,
          }
        : null;

  // Keep scrolling scoped to the log. `scrollIntoView` may pan every ancestor,
  // which fights the browser's own focused-input reveal while the keyboard opens.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (!didPositionRef.current || isNearBottomRef.current) {
      log.scrollTop = log.scrollHeight;
    }
    didPositionRef.current = true;
  }, [messages.length]);

  // Signed attachment URLs resolve after the message row mounts. Preserve the
  // bottom pin through those intrinsic-content changes only when the member was
  // already following the newest message.
  useEffect(() => {
    const log = logRef.current;
    const content = contentRef.current;
    if (!log || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Mark the conversation read on mount and whenever a new inbound (other-sent)
  // message arrives, so the unread badge clears while the thread is open.
  const inboundCount = useMemo(
    () => messages.filter((m) => m.sender_id !== currentUserId).length,
    [messages, currentUserId],
  );
  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId, inboundCount]);

  return (
    <section
      aria-label="Conversation"
      // White on a phone, where this is the whole screen. `--background` is a
      // violet-tinted near-white and `--card` is pure white, so the log sat on
      // a faintly grey field with a white bar welded to the top of it — three
      // points of lightness is not depth, it just looks like the header is a
      // different component.
      className="flex min-h-0 w-full flex-1 flex-col max-md:bg-card"
    >
      {/* ONE BAR, NOT TWO, AND THE ROOM'S BAR. This was a person header stacked
          on a full-width item card: two borders, two surfaces, two titles, and
          on phones the card's CTA went full width and forced a third row —
          about 150px of a viewport spent before the first message.
          `ContractChatBar` had already settled the shape, so this now matches it
          class for class: sticky, one ~56px row, `px-group` stepping down to
          `px-cozy` on a phone, a 36px thumb. It had been `px-7 py-3` with a 44px
          thumb, so the two surfaces this product treats as one thing were a
          visibly different height on a different left edge. */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-cozy border-b bg-card px-group py-2.5 max-md:px-cozy">
        {/* Phone only, as in the room. On desktop the rail's own Messages link
            is this exact destination, and a back arrow beside it is the same
            navigation offered twice. */}
        <Link
          href="/messages"
          transitionTypes={['nav-back']}
          // Pulled back by its own optical inset so the chevron, not the round
          // hit area, lines up with the content edge below it.
          className="-ml-1.5 inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris md:hidden"
          aria-label="Back to messages"
        >
          <HugeiconsIcon icon={ChevronLeftIcon} className="size-6" strokeWidth={1.75} aria-hidden />
        </Link>

        {itemThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={itemThumb}
            alt=""
            width={80}
            height={80}
            className="size-9 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <Avatar avatarPath={otherAvatarPath} displayName={displayName} size="md" />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
            {title}
          </h2>
          <p className="min-h-[1.1rem] truncate text-body leading-tight text-muted-foreground">
            {price ? (
              <span className="display-value font-semibold text-foreground">{price}</span>
            ) : null}
            {meta ? `${price ? ' · ' : ''}${meta}` : null}
            {offline ? (
              <span className="text-destructive" role="status">
                {price || meta ? ' · ' : ''}Offline
              </span>
            ) : null}
          </p>
        </div>

        {/* The one destination, back in the bar. It had moved to the dock to
            match where the ROOM puts its control — but the room's dock holds
            live actions on the contract, and a thread has none to hold: this
            is navigation, and it was the only thing in an otherwise purely
            informational strip. The title truncates harder for it, which is
            the trade being made. */}
        {dock ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href={dock.href} transitionTypes={['nav-forward']}>
              {dock.label}
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Message list (scrollable).
          `min-h-0` IS LOAD-BEARING. A flex item defaults to `min-height: auto`, which
          refuses to shrink below its content — so `flex-1` + `overflow-y-auto` alone grows
          the container to fit every message instead of scrolling, and the thread simply
          could not be scrolled. `ContractChat` already had `min-h-0 flex-1` on its
          equivalent wrapper and worked, which is what identified this. */}
      {/* Reads top-down. A previous pass bottom-anchored this with `mt-auto` on
          the chat convention, but on a thread that is mostly a contract record
          it only moved the empty space from under the content to above it, and
          a header floating clear of its own thread is worse than a short page.
          Asymmetric on purpose: the top inset separates the first line from the
          header hairline and wants room, while the bottom only has to keep the
          last line off the composer and reads as a gap if it matches. */}
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-group pb-3 pt-5 max-md:px-cozy"
        role="log"
        aria-label={`Conversation with ${displayName}`}
        aria-live="polite"
        onScroll={(event) => {
          const log = event.currentTarget;
          isNearBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        }}
      >
        {/* CAPPED, AND THE CAP IS THE POINT OF THE TWO-PANE LAYOUT'S OTHER HALF.
            Uncapped, this column inherited the whole content width — a bubble could
            run past 1000px on a wide viewport, which is roughly double a readable
            measure.
            
            BOTTOM-ANCHORED, WHICH REVERSES AN EARLIER DECISION IN THIS FILE. A previous
            pass bottom-anchored it, reverted, and left the reasoning above: on a thread
            that is mostly a contract record it only moved the empty space from under the
            content to above it, and a header floating clear of its own thread is worse
            than a short page.
            
            What changed is that the empty space is no longer the same size or in the same
            place. The thread had the full content width then; it now has a 44rem column
            inside a pane, so a two-message thread left several hundred pixels between the
            last bubble and the composer — the void is the loudest thing on the screen and
            it sits exactly where a reader looks to type. Anchoring to the bottom is also
            what every chat client does, and it is now the only reading consistent with
            this log's own empty state, which sits just above the composer for the same
            reason. The gap moves under the header, where it reads as "this conversation
            is new" rather than as a gap.
            
            `min-h-full`, NOT `h-full`: a thread longer than the pane has to be allowed to
            exceed it and scroll. `h-full` would clamp it to the container and clip.
            
            THE ANCHOR IS CONDITIONAL, and it has to be. An EMPTY thread centres its hint
            instead — and centring cannot be left to the hint's own classes, because a
            percentage height against this container's indefinite height resolves to auto,
            so the hint is a single line tall and `justify-end` would park it at the bottom
            whatever it asked for itself. The parent owns the axis, so the parent decides. */}
        <div
          ref={contentRef}
          className={cn(
            MESSAGE_COLUMN,
            'flex min-h-full flex-col',
            messages.length > 0 ? 'justify-end' : 'justify-center',
          )}
        >
          <MessageLog
            conversationId={conversationId}
            messages={messages}
            currentUserId={currentUserId}
            counterpartyName={displayName}
            counterpartyAvatarPath={otherAvatarPath}
            emptyHint="No messages yet. Say hello to start the conversation."
            shipment={shipment}
            showAvatars
            showReadReceipt
          />
        </div>
      </div>

      {/* THE TINTED DOCK IS GONE FROM THE THREAD. In the contract room that
          strip carries the live step's controls — Record shipment, Item never
          arrived — and earns its weight. Here it never had an action to hold:
          it was a title, a sentence saying the contract is handled elsewhere,
          and a link. The link is in the bar now.

          What does not survive the move is the standing warning that talking
          holds nothing, and that is worth a line on its own — it is the only
          thing on this screen that says the conversation is not protection. */}
      {dock && !dock.underContract ? (
        // The rule spans the pane, the sentence sits in the reading column — same
        // division as the composer below it. Left full width, this line started at the
        // pane's edge while every bubble above it began 40px in, which read as a
        // different component rather than as part of the thread.
        //
        // A div wrapping a p, not a p with a wrapped child: a block element inside a
        // <p> is invalid and the browser closes the paragraph early, which shows up as
        // a hydration mismatch rather than as a layout bug.
        <div className="shrink-0 border-t px-group py-cozy max-md:px-cozy">
          <p className={cn(MESSAGE_COLUMN, 'text-body text-muted-foreground')}>
            Nothing is held while you are only talking. Make or accept an offer on
            the listing to open a contract.
          </p>
        </div>
      ) : null}

      <MessageComposer
        conversationId={conversationId}
        inputId="message-composer"
        // Same column as the log, so the field's edges line up with the bubbles
        // rather than running the full width of the pane underneath them.
        contentClassName={MESSAGE_COLUMN}
        optimistic={{
          currentUserId,
          add: addOptimistic,
          settle: settleOptimistic,
        }}
      />
    </section>
  );
}
