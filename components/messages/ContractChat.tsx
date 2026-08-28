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
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ChevronLeftIcon, InfoIcon } from '@hugeicons/core-free-icons';
import { Avatar } from '@/components/ui/avatar';
import { ContractOverflowMenu } from '@/components/contract/ContractActionCard';
import { useContractFocus } from '@/components/contract/ContractFocus';
import { useContractSplit } from '@/components/contract/useContractSplit';
import { markConversationRead } from '@/lib/actions/messages';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import { MessageComposer } from '@/components/messages/MessageComposer';
import {
  MessageLog,
  type MessageLogShipment,
} from '@/components/messages/MessageLog';
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
   * The live-step control, docked between the log and the composer.
   *
   * Pass `ContractActionCard` with `appearance="dock"`. It used to ride the
   * subject bar as `appearance="header"`, which made a wide control ("Accept
   * terms and pay") wrap the bar onto a second line and put the thing you have
   * to DO furthest from the thing you just read.
   */
  actions?: ReactNode;
  /** Secondary actions about the counterparty, in the subject bar's ⋯ menu. */
  menu?: ReactNode;
  /**
   * Where the phone's back control goes. Below `md` this bar is the whole top
   * of the room, so it carries navigation; above `md` the workspace rail does.
   */
  backHref?: string;
  /** The flow's status in words, e.g. "In transit". Joins the subline. */
  statusLabel?: string | null;
  /** Carrier details, so the shipped milestone can link out to tracking. */
  shipment?: MessageLogShipment | null;
  className?: string;
}

export function ContractChatBar({
  counterpartyName,
  counterpartyAvatarPath,
  subject,
  connectionStatus,
  backHref,
  statusLabel,
  menu,
}: {
  counterpartyName: string;
  counterpartyAvatarPath?: string | null;
  subject?: ContractChatSubject | null;
  connectionStatus?: 'ok' | 'error' | string;
  backHref?: string;
  statusLabel?: string | null;
  /** Secondary actions about the PERSON, e.g. reporting them. */
  menu?: ReactNode;
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
    // Identity and subject only. The controls used to ride this row and wrap to
    // a second line when they were wide ("Accept terms and pay"); they dock
    // below the log now, so the bar is a fixed single row again.
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-cozy border-b bg-card px-group py-2.5 max-md:px-cozy">
      {backHref ? (
        <Link
          href={backHref}
          transitionTypes={['nav-back']}
          aria-label="Back"
          // `size-11`: this control only exists below `md`, so it is a touch
          // target in every case it renders and has no business being 40px.
          className="-ml-1.5 inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris md:hidden"
        >
          <HugeiconsIcon icon={ChevronLeftIcon} className="size-6" strokeWidth={1.75} aria-hidden />
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
            {/* NAMES THE DESTINATION, does not point. This was a `ChevronRight`,
                which put a right-facing chevron at one end of the bar and the
                back arrow at the other — the universal prev/next pager shape, on
                a row that has no next. Nothing here pages between contracts:
                this opens the details sheet for the one already on screen. */}
            <HugeiconsIcon icon={InfoIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {/* Overlay rather than a wrapper, because the title is an <h2> and a
                heading is not valid inside a <button>. Covering the block keeps
                the whole subject tappable and still gives one focus ring. */}
            <button
              type="button"
              onClick={openDetails}
              aria-haspopup="dialog"
              className="absolute inset-0 rounded-md border border-transparent focus:outline-none focus-visible:border-iris"
            >
              <span className="sr-only">Contract details</span>
            </button>
          </>
        ) : null}
      </div>

      {/* Outside the subject block on purpose: that block is covered by an
          absolutely positioned button that opens the details sheet, and a menu
          inside it would be unclickable. Reporting is about the person, which
          is what this bar is, so it belongs here rather than in the action
          dock's menu — the dock is the contract's current step. */}
      <ContractOverflowMenu>{menu}</ContractOverflowMenu>
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
  menu,
  backHref,
  statusLabel,
  shipment = null,
  className,
}: ContractChatProps) {
  const { messages, connectionStatus, addOptimistic, settleOptimistic } =
    useConversationRealtime(conversationId);
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
        // `bg-card` at every width now. Below `md` this was transparent, which
        // dropped the column onto the page's tinted `--background` while its
        // own bar stayed white; the inbox thread had the same split, and the
        // two surfaces are meant to be indistinguishable.
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:shadow-none',
        className,
      )}
    >
      {/* Header, log, and composer all sit on the panel's own `bg-card`: the
          card is one surface and the border rules divide it. Tinting each band
          separately banded the panel, and with only 3 points of lightness
          between `--card` and `--background` the tints read as dirt, not depth.
          Depth comes from the bubbles instead. */}
      {/* No `actions` here any more — they dock below the log instead. The bar
          is identity and subject; the live control belongs at the end of the
          conversation, where the next thing to happen would appear. */}
      <ContractChatBar
        counterpartyName={counterpartyName}
        counterpartyAvatarPath={counterpartyAvatarPath}
        subject={subject}
        connectionStatus={connectionStatus}
        backHref={backHref}
        statusLabel={statusLabel}
        menu={menu}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          // `flex-1 min-h-0`, NOT `h-full`, AND THAT IS THE SCROLL BUG.
          // `height: 100%` here resolved against a parent sized by `flex: 1 1 0%`
          // and did not resolve — it fell back to the content height. Measured on
          // a 390x844 phone the parent was 521px while this element was 819px,
          // with `scrollHeight === clientHeight`: not a scroll container at all.
          // The log laid itself out at full length, ran under the docked action
          // strip and the composer, and got clipped. The newest messages sat
          // behind the dock and could not be reached, and `scrollTo` on a new
          // message was a no-op because there was nothing to scroll. Every other
          // rung of this chain already used `flex-1 min-h-0`, and every one of
          // them resolved correctly — this was the only `h-full`.
          //
          // `overflow-hidden` on the parent is not the fix and was masking it:
          // it stops the bleed and leaves the log just as unscrollable.
          //
          // Contained at every width. This used to be `lg:` only because below
          // the split the room stacked and the PAGE was the scroller, so
          // containing here dead-ended the swipe at the end of the log. The
          // phone room is a thread: the log is the only scroller, the composer
          // is pinned under it, and there is nothing behind to scroll on to.
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-cozy"
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
            shipment={shipment}
            showNames
          />
        </div>
        {!isNearBottom && unseenCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 touch-manipulation items-center gap-tight rounded-full border border-transparent bg-primary px-cozy py-2 text-body font-medium text-primary-foreground shadow-md focus:outline-none focus-visible:border-iris"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" aria-hidden />
            {unseenCount === 1 ? '1 new message' : `${unseenCount} new messages`}
          </button>
        ) : null}
      </div>
      {/* THE ONE LIVE CONTROL, docked between the log and the composer.
          Pinned rather than threaded into the log on purpose. The log is a
          historical record and the action is a function of CURRENT status, so a
          card attached to the event that triggered it would still be offering
          "Add details" on a dispute that has since been resolved. Sitting here
          it reads as the next thing in the conversation, stays put when the log
          scrolls, and there is still only one of it. */}
      {/* `relative z-10` and an opaque surface, not decoration. The log above is
          a positioned box, so a static dock loses the paint-order fight and the
          last bubbles draw straight over this strip; and the dock's tone is a
          tint, which needs something opaque under it — the panel itself is
          transparent below `md`. */}
      {actions ? (
        <div className="relative z-10 shrink-0 border-t bg-card">{actions}</div>
      ) : null}
      <MessageComposer
        conversationId={conversationId}
        placeholder={placeholder}
        inputId={`contract-chat-${conversationId}`}
        compact
        optimistic={{
          currentUserId,
          add: addOptimistic,
          settle: settleOptimistic,
        }}
      />
    </section>
  );
}
