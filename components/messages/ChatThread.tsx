'use client';

// components/messages/ChatThread.tsx
//
// The live conversation view. Renders a header (the other participant + optional
// item context link), a grouped realtime message list, and a composer that can
// send text plus one photo or PDF.
//
// Realtime message state comes from `useConversationRealtime`; the composer
// optimistically relies on the realtime INSERT to append the sent message. The
// thread auto-scrolls to the newest message and marks the conversation read on
// mount (and whenever new inbound messages arrive).

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import {
  markConversationRead,
  type ConversationItemSummary,
} from '@/lib/actions/messages';
import { formatAud, itemImageUrl } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { MessageLog } from '@/components/messages/MessageLog';

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
}

export function ChatThread({
  conversationId,
  currentUserId,
  otherName,
  otherAvatarPath = null,
  item,
  trade = null,
}: ChatThreadProps) {
  const { messages, connectionStatus } = useConversationRealtime(conversationId);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const displayName = otherName?.trim() || 'NoDitto member';
  const itemThumb = item ? itemImageUrl(item.imagePath) : null;

  // Auto-scroll to the newest message whenever the list grows/changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

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
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      {/* Header: back button + the other participant. The subject moved into its
          own context card below — a person bar and an item card are two facts,
          and the card gives the item room for a price and a CTA (Xianyu-style). */}
      <header className="flex items-center justify-between gap-4 border-b pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/messages"
            transitionTypes={['nav-back']}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to messages"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <Avatar avatarPath={otherAvatarPath} displayName={displayName} size="sm" />
          <h2 className="min-w-0 truncate text-subhead font-semibold tracking-tight">
            {displayName}
          </h2>
        </div>

        {connectionStatus === 'error' ? (
          <span
            className="flex shrink-0 items-center gap-tight text-meta text-destructive"
            role="status"
          >
            <span className="inline-block size-2 rounded-full bg-destructive" aria-hidden />
            Offline
          </span>
        ) : null}
      </header>

      {/* Item / contract context card: what this thread is about, what it costs,
          and the one place to jump to the listing or the live contract. */}
      {item || trade ? (
        <div className="flex shrink-0 items-center gap-3 border-b bg-muted px-1 py-3">
          {itemThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={itemThumb}
              alt=""
              width={112}
              height={112}
              className="size-14 shrink-0 rounded-md border object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lead font-semibold leading-tight tracking-tight">
              {item ? item.title : '2-way trade'}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {item?.priceCents != null ? (
                <span className="display-value text-body font-semibold">
                  {formatAud(item.priceCents)}
                </span>
              ) : null}
              {item?.status && item.status !== 'AVAILABLE' ? (
                <span className="rounded-full border px-2 py-0.5 text-meta capitalize text-muted-foreground">
                  {item.status.toLowerCase().replace(/_/g, ' ')}
                </span>
              ) : null}
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            {trade ? (
              <Link
                href={`/trades/${trade.id}`}
                transitionTypes={['nav-forward']}
              >
                Open contract
              </Link>
            ) : (
              <Link
                href={`/listings/${item!.id}`}
                transitionTypes={['nav-forward']}
              >
                View listing
              </Link>
            )}
          </Button>
        </div>
      ) : null}

      {/* Message list (scrollable).
          `min-h-0` IS LOAD-BEARING. A flex item defaults to `min-height: auto`, which
          refuses to shrink below its content — so `flex-1` + `overflow-y-auto` alone grows
          the container to fit every message instead of scrolling, and the thread simply
          could not be scrolled. `ContractChat` already had `min-h-0 flex-1` on its
          equivalent wrapper and worked, which is what identified this. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4"
        role="log"
        aria-label={`Conversation with ${displayName}`}
        aria-live="polite"
      >
        <MessageLog
          conversationId={conversationId}
          messages={messages}
          currentUserId={currentUserId}
          counterpartyName={displayName}
          counterpartyAvatarPath={otherAvatarPath}
          emptyHint="No messages yet. Say hello to start the conversation."
          showAvatars
          showReadReceipt
        />
        <div ref={bottomRef} />
      </div>

      <MessageComposer conversationId={conversationId} inputId="message-composer" />
    </section>
  );
}
