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
 * always given a real bounded height by the parent `ContractWorkspace`, so
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
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">With {counterpartyName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                'size-2 rounded-full',
                connectionStatus === 'live' ? 'bg-emerald-500' : 'bg-amber-500',
              )}
              aria-hidden
            />
            {connectionStatus === 'live' ? 'Live' : 'Connecting'}
          </span>
          {contractHref ? (
            <Link
              href={contractHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open full conversation
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          className="h-full space-y-3 overflow-y-auto bg-background p-4"
          role="log"
          aria-label={`Chat with ${counterpartyName}`}
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <p className="max-w-48 text-sm text-muted-foreground">{emptyHint}</p>
            </div>
          ) : (
            messages.map((message) => {
              // Contract events are mirrored into the thread as SYSTEM messages:
              // same table, same ordering, but centred and unattributed.
              if (message.kind === 'SYSTEM') {
                return (
                  <div key={message.id} className="flex justify-center">
                    <p className="max-w-[90%] rounded-full border border-dashed bg-muted/40 px-3 py-1.5 text-center text-xs text-muted-foreground">
                      {message.body}
                    </p>
                  </div>
                );
              }
              const mine = message.sender_id === currentUserId;
              return (
                <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-3 py-2 text-sm',
                      mine
                        ? 'rounded-br-sm bg-primary text-primary-foreground'
                        : 'rounded-bl-sm border bg-card',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!isNearBottom && unseenCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unseenCount === 1 ? '1 new message' : `${unseenCount} new messages`}
          </button>
        ) : null}
      </div>
      <form onSubmit={submit} className="border-t p-3">
        <div className="flex items-center gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim() && !isPending) {
                  submit(event as unknown as FormEvent);
                }
              }
            }}
            placeholder={placeholder}
            maxLength={MESSAGE_BODY_MAX}
            rows={2}
            disabled={isPending}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!draft.trim() || isPending}
            aria-label="Send message"
          >
            {isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </form>
    </section>
  );
}
