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
import Link from 'next/link';
import { ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { useContractFocus } from '@/components/contract/ContractFocus';
import { useContractSplit } from '@/components/contract/useContractSplit';
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
  /**
   * Where the phone's back control goes. Below `md` this bar is the whole top
   * of the room, so it carries navigation; above `md` the workspace rail does.
   */
  backHref?: string;
  /** The flow's status in words, e.g. "In transit". Joins the subline. */
  statusLabel?: string | null;
  className?: string;
}

export function ContractChatBar({
  counterpartyName,
  counterpartyAvatarPath,
  subject,
  actions,
  connectionStatus,
  backHref,
  statusLabel,
}: {
  counterpartyName: string;
  counterpartyAvatarPath?: string | null;
  subject?: ContractChatSubject | null;
  actions?: ReactNode;
  connectionStatus?: 'ok' | 'error' | string;
  backHref?: string;
  statusLabel?: string | null;
}) {
  const offline = connectionStatus === 'error';
  const split = useContractSplit();
  const { openDetails } = useContractFocus();

  // In the thread the details are a sheet, so the identity block is the way in.
  // In the split they are a pane already on screen and this stays inert text.
  const opensDetails = !split;

  // Everything after the price, in order. Joined with the same separator so an
  // absent status or a bare person both read correctly.
  const meta = [statusLabel, subject ? counterpartyName : null].filter(
    (part): part is string => Boolean(part),
  );
  const showSubline = Boolean(subject?.price) || meta.length > 0 || offline;

  return (
    // `flex-wrap` rather than a hard `flex-col` on phones: a short control set
    // ("Track", "Cancel") rides on the identity row, and only a wide one
    // ("Accept terms and pay") drops to a second line. Sticky so the subject
    // and the live control stay reachable while the log scrolls under them.
    <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-cozy gap-y-snug border-b bg-card px-group py-2.5 max-md:px-cozy">
      {backHref ? (
        <Link
          href={backHref}
          transitionTypes={['nav-back']}
          aria-label="Back"
          className="-ml-1.5 inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-gold/40 md:hidden"
        >
          <ChevronLeft className="size-6" strokeWidth={1.75} aria-hidden />
        </Link>
      ) : null}

      <div className="relative flex min-w-0 flex-1 basis-40 items-center gap-cozy">
        {subject?.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={subject.thumb}
            alt=""
            width={80}
            height={80}
            className="size-9 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <Avatar
            avatarPath={counterpartyAvatarPath}
            displayName={counterpartyName}
            size="md"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
            {subject?.title ?? counterpartyName}
          </h2>
          {showSubline ? (
            <p className="truncate text-body leading-tight text-muted-foreground">
              {subject?.price ? (
                <span className="display-value font-semibold text-foreground">
                  {subject.price}
                </span>
              ) : null}
              {meta.length > 0
                ? `${subject?.price ? ' · ' : ''}${meta.join(' · ')}`
                : null}
              {offline ? (
                <span className="text-destructive">
                  {subject?.price || meta.length > 0 ? ' · ' : ''}Offline
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {opensDetails ? (
          <>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {/* Overlay rather than a wrapper, because the title is an <h2> and a
                heading is not valid inside a <button>. Covering the block keeps
                the whole subject tappable and still gives one focus ring. */}
            <button
              type="button"
              onClick={openDetails}
              aria-haspopup="dialog"
              className="absolute inset-0 rounded-md border border-transparent focus:outline-none focus-visible:border-gold/40"
            >
              <span className="sr-only">Contract details</span>
            </button>
          </>
        ) : null}
      </div>

      {actions ? (
        <div className="flex min-w-0 shrink-0 items-center justify-end">
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
  backHref,
  statusLabel,
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
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none',
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
        backHref={backHref}
        statusLabel={statusLabel}
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          // Contained at every width now. This used to be `lg:` only because
          // below the split the room stacked and the PAGE was the scroller, so
          // containing here dead-ended the swipe at the end of the log. The
          // phone room is a thread: the log is the only scroller, the composer
          // is pinned under it, and there is nothing behind to scroll on to.
          className="h-full overflow-y-auto overscroll-contain p-cozy"
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
