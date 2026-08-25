'use client';

// components/messages/ContractChat.tsx
//
// The compact live participant chat embedded in a contract room — the cash sale
// room (Req 4.2) and the private deal room both render it in their middle
// column, so the two flows behave and read identically.
//
// Header is Xianyu-shaped: a person bar (avatar + name), then a product strip
// (thumb, title, price, live CTAs). The thread itself is generic — it takes a
// conversationId — and contract history arrives as SYSTEM messages.

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { ArrowDown } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { markConversationRead } from '@/lib/actions/messages';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { MessageLog } from '@/components/messages/MessageLog';
import { cn } from '@/lib/utils';

/** How close to the bottom (px) still counts as "already reading the latest". */
const FOLLOW_THRESHOLD_PX = 48;

/** The item this thread is about — Xianyu pins it under the person bar. */
export interface ContractChatSubject {
  title: string;
  /** Resolved image URL, already public. */
  thumb?: string | null;
  /** Formatted price, e.g. "$84.00". */
  price?: string | null;
}

export interface ContractChatProps {
  conversationId: string;
  currentUserId: string;
  counterpartyName: string;
  /** Avatar object path, or null. A PATH, not a URL. */
  counterpartyAvatarPath?: string | null;
  /**
   * @deprecated The counterpart's name is the heading now (Xianyu person bar).
   * Kept so existing call sites do not break.
   */
  title?: string;
  /** Composer placeholder. */
  placeholder?: string;
  /** Copy shown while the thread is empty. */
  emptyHint?: string;
  /** Item strip under the person bar: thumb, title, price, then the live CTAs. */
  subject?: ContractChatSubject | null;
  /**
   * Live-step controls. Sit on the product strip (right), the way 闲鱼 puts
   * 我想要 / 去支付 beside the goods — not next to the person's name.
   */
  actions?: ReactNode;
  className?: string;
}

export function ContractChatBar({
  counterpartyName,
  counterpartyAvatarPath,
  subject,
  actions,
  connectionStatus,
}: {
  counterpartyName: string;
  counterpartyAvatarPath?: string | null;
  subject?: ContractChatSubject | null;
  actions?: ReactNode;
  connectionStatus?: 'ok' | 'error' | string;
}) {
  const offline = connectionStatus === 'error';

  return (
    <header
      className={cn(
        'flex shrink-0 gap-cozy border-b px-group py-3.5',
        actions ? 'flex-col md:flex-row md:items-center' : 'items-center',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-cozy">
        <Avatar
          avatarPath={counterpartyAvatarPath}
          displayName={counterpartyName}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
            {subject?.title ?? counterpartyName}
          </h2>
          {subject || offline ? (
            <p className="truncate text-body leading-tight text-muted-foreground">
              {subject?.price ? (
                <span className="display-value font-semibold text-foreground">
                  {subject.price}
                </span>
              ) : null}
              {subject?.price && subject ? ' · ' : null}
              {subject ? counterpartyName : null}
              {offline ? (
                <span className="text-destructive">
                  {subject ? ' · Offline' : 'Offline'}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex min-w-0 w-full items-center md:w-auto md:shrink-0 md:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
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
  counterpartyAvatarPath,
  placeholder = 'Message about the handover…',
  emptyHint = 'Use chat to coordinate. Only the saved terms are binding.',
  subject,
  actions,
  className,
}: ContractChatProps) {
  const { messages, connectionStatus } = useConversationRealtime(conversationId);
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

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
    >
      {/* Header, log, and composer all sit on the panel's own `bg-card`: the
          card is one surface and the border rules divide it. Tinting each band
          separately banded the panel, and with only 3 points of lightness
          between `--card` and `--background` the tints read as dirt, not depth.
          Depth comes from the bubbles instead. */}
      <ContractChatBar
        counterpartyName={counterpartyName}
        counterpartyAvatarPath={counterpartyAvatarPath}
        subject={subject}
        actions={actions}
        connectionStatus={connectionStatus}
      />
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
          className="h-full overflow-y-auto p-cozy lg:overscroll-contain"
          role="log"
          aria-label={`Chat with ${counterpartyName}`}
          aria-live="polite"
        >
          <MessageLog
            conversationId={conversationId}
            messages={messages}
            currentUserId={currentUserId}
            counterpartyName={counterpartyName}
            counterpartyAvatarPath={counterpartyAvatarPath}
            emptyHint={emptyHint}
            showNames
          />
        </div>
        {!isNearBottom && unseenCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 touch-manipulation items-center gap-tight rounded-full border border-transparent bg-primary px-cozy py-2 text-body font-medium text-primary-foreground shadow-md focus:outline-none focus-visible:border-gold/40"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unseenCount === 1 ? '1 new message' : `${unseenCount} new messages`}
          </button>
        ) : null}
      </div>
      <MessageComposer
        conversationId={conversationId}
        placeholder={placeholder}
        inputId={`contract-chat-${conversationId}`}
        compact
      />
    </section>
  );
}
