'use client';

// components/messages/ContractChat.tsx
//
// The compact live participant chat embedded in a contract room — the cash sale
// room (Req 4.2) and the private deal room both render it in their middle
// column, so the two flows behave and read identically.
//
// It is generic over the thread: it takes a `conversationId` and nothing else
// about what the contract is. Contract history arrives in the same thread as
// stored SYSTEM messages (mirrored by database triggers), which render as
// centred, unattributed notes.

import { useEffect, useRef, useState, useTransition, type FormEvent, type UIEvent } from 'react';
import Link from 'next/link';
import { ArrowDown, ExternalLink, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sendMessage, markConversationRead } from '@/lib/actions/messages';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import { MESSAGE_BODY_MAX } from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';

/** How close to the bottom (px) still counts as "already reading the latest". */
const FOLLOW_THRESHOLD_PX = 48;

export interface ContractChatProps {
  conversationId: string;
  currentUserId: string;
  counterpartyName: string;
  /** Panel heading. Defaults to the neutral "Contract chat". */
  title?: string;
  /** Composer placeholder. */
  placeholder?: string;
  /** Copy shown while the thread is empty. */
  emptyHint?: string;
  /** Link to the full `/messages/[id]` thread for this contract's conversation. */
  contractHref?: string;
  className?: string;
}

/**
 * Chat panel embedded in a contract room (demo-contract-ux Req 1). It is
 * always given a real bounded height by `ContractSplit`, so
 * only the message log scrolls — the header and composer stay pinned, and
 * the contract page itself never grows with the conversation.
 */
export function ContractChat({
  conversationId,
  currentUserId,
  counterpartyName,
  title = 'Contract chat',
  placeholder = 'Message about the handover…',
  emptyHint = 'Use chat to coordinate. Only the saved terms are binding.',
  contractHref,
  className,
}: ContractChatProps) {
  const { messages, connectionStatus } = useConversationRealtime(conversationId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const previousCount = useRef(messages.length);

  // Follow the newest message only while the reader is already near the
  // bottom; otherwise surface a "new messages" affordance instead of yanking
  // their scroll position (demo-contract-ux Req 1.5).
  useEffect(() => {
    const added = messages.length - previousCount.current;
    previousCount.current = messages.length;
    const log = logRef.current;
    if (isNearBottom) {
      log?.scrollTo({ top: log.scrollHeight });
      setUnseenCount(0);
    } else if (added > 0) {
      setUnseenCount((count) => count + added);
    }
    void markConversationRead(conversationId);
  }, [conversationId, messages.length, isNearBottom]);

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const log = event.currentTarget;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    const nearBottom = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    setIsNearBottom(nearBottom);
    if (nearBottom) setUnseenCount(0);
  }

  function scrollToLatest() {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    setIsNearBottom(true);
    setUnseenCount(0);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || body.length > MESSAGE_BODY_MAX || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessage(conversationId, body);
      if (result.ok) setDraft('');
      else setError('Message could not be sent.');
    });
  }

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/90 bg-card shadow-sm',
        className,
      )}
    >
      {/* Header, log, and composer all sit on the panel's own `bg-card`: the
          card is one surface and the border rules divide it. Tinting each band
          separately banded the panel, and with only 3 points of lightness
          between `--card` and `--background` the tints read as dirt, not depth.
          Depth comes from the bubbles instead. */}
      <header className="flex items-center justify-between gap-3 border-b px-group py-cozy">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground">
            <Send className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-body font-semibold">{title}</h2>
            <p className="truncate text-meta text-muted-foreground">
              With {counterpartyName}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {connectionStatus === 'error' ? (
            <span
              className="flex items-center gap-tight text-meta text-destructive"
              role="status"
            >
              <span className="size-2 rounded-full bg-destructive" aria-hidden />
              Offline
            </span>
          ) : null}
          {contractHref ? (
            <Link
              href={contractHref}
              className="inline-flex touch-manipulation items-center gap-1 rounded-sm text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open Conversation
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          // `overscroll-contain` only from `lg`, matching the details panel this
          // sits beside (see ContractDetailList). At `lg` the room is bounded and
          // the page behind does not scroll, so containment costs nothing and
          // stops the gesture escaping to the pane wrapper. Below `lg` the room
          // stacks and the PAGE is the scroller, so containing here dead-ended
          // the swipe: reaching the end of the log stopped the gesture instead of
          // carrying on down the page, and the reader had to lift and re-swipe
          // outside the log to continue. The two panes stack at the same
          // breakpoint, so they must make the same choice.
          className="h-full space-y-3 overflow-y-auto p-cozy lg:overscroll-contain"
          role="log"
          aria-label={`Chat with ${counterpartyName}`}
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <p className="max-w-56 text-body leading-5 text-muted-foreground">{emptyHint}</p>
            </div>
          ) : (
            messages.map((message, index) => {
              // Contract events are mirrored into the thread as SYSTEM messages:
              // same table, same ordering, but centred and unattributed.
              if (message.kind === 'SYSTEM') {
                return (
                  <div key={message.id} className="flex justify-center">
                    <p className="max-w-[92%] break-words rounded-2xl border border-dashed bg-muted/40 px-cozy py-tight text-center text-meta leading-4 text-muted-foreground">
                      {message.body}
                    </p>
                  </div>
                );
              }
              const mine = message.sender_id === currentUserId;
              const senderName = mine ? 'You' : counterpartyName;
              // Show the name when the previous message was from a different sender
              // or is a system message (i.e. start of a new run from this person).
              const prev = index > 0 ? messages[index - 1] : null;
              const showName =
                !prev ||
                prev.kind === 'SYSTEM' ||
                prev.sender_id !== message.sender_id;
              const time = new Date(message.created_at);
              const timeLabel = time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              return (
                <div key={message.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  {showName ? (
                    <span className={cn('mb-0.5 px-1 text-meta font-medium text-muted-foreground')}>
                      {senderName}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-3 py-2 text-body',
                      mine
                        ? 'rounded-br-sm bg-primary text-primary-foreground'
                        : 'rounded-bl-sm bg-muted text-foreground',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                  <span className={cn('mt-0.5 px-1 text-meta text-muted-foreground/60')}>
                    {timeLabel}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {!isNearBottom && unseenCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 touch-manipulation items-center gap-tight rounded-full bg-primary px-cozy py-2 text-meta font-medium text-primary-foreground shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unseenCount === 1 ? '1 new message' : `${unseenCount} new messages`}
          </button>
        ) : null}
      </div>
      <form onSubmit={submit} className="border-t p-cozy">
        <label htmlFor={`contract-chat-${conversationId}`} className="sr-only">
          Write a message
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id={`contract-chat-${conversationId}`}
            name="message"
            autoComplete="off"
            enterKeyHint="send"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Only submit on Enter from pointer devices; touch needs Enter for newlines.
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                window.matchMedia('(hover: hover)').matches
              ) {
                event.preventDefault();
                if (draft.trim() && !isPending) {
                  submit(event as unknown as FormEvent);
                }
              }
            }}
            placeholder={placeholder}
            maxLength={MESSAGE_BODY_MAX}
            rows={1}
            className="max-h-24 min-h-10 resize-none"
            readOnly={isPending}
          />
          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0"
            disabled={!draft.trim() || isPending}
            aria-label="Send message"
          >
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-body text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
