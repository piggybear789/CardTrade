'use client';

// components/messages/ChatThread.tsx
//
// The live conversation view. Renders a header (the other participant + optional
// item context link), a scrollable, realtime message list (own messages
// right-aligned, the other participant's left-aligned, each with a timestamp),
// and a composer that sends messages through the `sendMessage` server action.
//
// Realtime message state comes from `useConversationRealtime`; the composer
// optimistically relies on the realtime INSERT to append the sent message. The
// thread auto-scrolls to the newest message and marks the conversation read on
// mount (and whenever new inbound messages arrive).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import {
  sendMessage,
  markConversationRead,
} from '@/lib/actions/messages';
import { MESSAGE_BODY_MAX } from '@/lib/marketplace-constants';
import { formatRelativeTime, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';

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
  item: { id: string; title: string; imagePath: string | null } | null;
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
  const router = useRouter();
  const { messages, connectionStatus } = useConversationRealtime(conversationId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();

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

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MESSAGE_BODY_MAX && !isSending;

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const body = trimmed;
    setError(null);
    startSending(async () => {
      const result = await sendMessage(conversationId, body);
      if (result.ok) {
        setDraft('');
        return;
      }
      setError(
        result.error === 'invalid-body'
          ? 'Message must be between 1 and 4000 characters.'
          : result.error === 'not-participant'
            ? 'You are no longer part of this conversation.'
            : 'Message could not be sent. Please try again.',
      );
    });
  }

  // Enter sends on pointer devices; touch needs Enter for newlines.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      window.matchMedia('(hover: hover)').matches
    ) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <section
      aria-label="Conversation"
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      {/* Header: back button + other participant + optional item context. */}
      <header className="flex items-center justify-between gap-4 border-b pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          {itemThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={itemThumb}
              alt=""
              width={96}
              height={96}
              className="size-12 shrink-0 rounded-md object-cover"
            />
          ) : null}
          <div className="min-w-0">
            {/* Name and subject on ONE line. They are one fact — who this is with and
                what it is about — and stacking them made the header taller while pushing
                the messages down. The subject stays a link; only its position changed. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="max-w-[55%] truncate text-subhead font-semibold tracking-tight">
                {displayName}
              </h2>
              {trade ? (
                <Link
                  href={`/trades/${trade.id}`}
                  className="truncate text-body text-muted-foreground underline-offset-4 hover:underline"
                >
                  Trade contract
                </Link>
              ) : item ? (
                <Link
                  href={`/listings/${item.id}`}
                  className="truncate text-body text-muted-foreground underline-offset-4 hover:underline"
                >
                  Re: {item.title}
                </Link>
              ) : (
                <p className="truncate text-body text-muted-foreground">Direct message</p>
              )}
            </div>
          </div>
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

      {/* Message list (scrollable).
          `min-h-0` IS LOAD-BEARING. A flex item defaults to `min-height: auto`, which
          refuses to shrink below its content — so `flex-1` + `overflow-y-auto` alone grows
          the container to fit every message instead of scrolling, and the thread simply
          could not be scrolled. `ContractChat` already had `min-h-0 flex-1` on its
          equivalent wrapper and worked, which is what identified this. */}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-4"
        role="log"
        aria-label={`Conversation with ${displayName}`}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-body text-muted-foreground">
            No messages yet. Say hello to start the conversation.
          </p>
        ) : (
          messages.map((message) => {
            // A mirrored contract event: centred, unattributed, still in order.
            if (message.kind === 'SYSTEM') {
              return (
                  <div key={message.id} className="flex justify-center">
                  <p className="max-w-[85%] break-words rounded-full border border-dashed bg-muted/40 px-cozy py-tight text-center text-meta text-muted-foreground">
                    {message.body}
                  </p>
                </div>
              );
            }
            const isMine = message.sender_id === currentUserId;
            return (
              <div
                key={message.id}
                className={cn(
                  // `items-center`, not `items-end`. The bubble carries its own
                  // timestamp line, so it is ~54px tall against a 24px avatar —
                  // bottom-aligning parked the avatar beside the date rather than
                  // beside the message, and on a multi-line message it drifted
                  // further still. Chat convention bottom-aligns to hug the tail of
                  // the bubble; that convention assumes a bubble whose last line IS
                  // the message.
                  'flex items-center gap-2',
                  isMine ? 'justify-end' : 'justify-start',
                )}
              >
                {/* Only on INCOMING messages. Repeating the viewer's own picture
                    beside every message they sent adds nothing — they know who they
                    are — and would halve the width available to the text. */}
                {isMine ? null : (
                  <Avatar
                    avatarPath={otherAvatarPath}
                    displayName={displayName}
                    size="xs"
                  />
                )}
                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-2 text-meta',
                    isMine
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <time
                    dateTime={message.created_at}
                    suppressHydrationWarning
                    className={cn(
                      'mt-1 block text-meta',
                      isMine
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground',
                    )}
                  >
                    {formatRelativeTime(message.created_at)}
                    {isMine && message.read_at ? ' · Read' : ''}
                  </time>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer. */}
      <form onSubmit={handleSubmit} className="border-t pt-4">
        <label htmlFor="message-composer" className="sr-only">
          Write a message
        </label>
        <div className="flex items-center gap-2">
          <Textarea
            id="message-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            enterKeyHint="send"
            placeholder="Write a message…"
            rows={2}
            maxLength={MESSAGE_BODY_MAX}
            className="min-h-[44px] resize-none"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'composer-error' : undefined}
          />
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            {isSending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
          </Button>
        </div>
        {error && (
          <p id="composer-error" role="alert" className="mt-2 text-body text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
