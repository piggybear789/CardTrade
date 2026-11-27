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
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { CaretDownIcon, CaretLeftIcon, SealCheckIcon } from '@/components/ui/icons';
import { Avatar } from '@/components/ui/avatar';
import { ContractOverflowMenu } from '@/components/contract/ContractActionCard';
import { useContractSplit } from '@/components/contract/useContractSplit';
import { markConversationRead } from '@/lib/actions/messages';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import { MessageComposer } from '@/components/messages/MessageComposer';
import {
  MessageLog,
  type MessageLogSaleContext,
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

/** Trust facts for the person line of the chat bar. */
export interface ContractChatCounterparty {
  verified: boolean;
  /** Average out of 5, or null when never reviewed. */
  rating: number | null;
  ratingCount: number;
}

export interface ContractChatProps {
  conversationId: string;
  currentUserId: string;
  counterpartyName: string;
  /** Avatar object path, or null. A PATH, not a URL. */
  counterpartyAvatarPath?: string | null;
  /** ID check and rating, for the person line. */
  counterparty?: ContractChatCounterparty | null;
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
  /**
   * The flow's status, as the room's own badge (`CashSaleStatusBadge`,
   * `StateBadge`). A NODE, NOT A STRING: the badge is the one place a status has a
   * label and a tone, and the inbox row already uses it — a word in a muted
   * sentence here was the same status at a third of the visibility.
   */
  status?: ReactNode;
  /** Passed to the bar; see ContractChatBar. */
  assurance?: ReactNode;
  /** Passed to the bar; see ContractChatBar. */
  progress?: ReactNode;
  /** Carrier details, so the shipped milestone can link out to tracking. */
  shipment?: MessageLogShipment | null;
  /** Cash_Sale provenance for event wording and shipment-link ownership. */
  saleContext?: MessageLogSaleContext | null;
  className?: string;
}

export function ContractChatBar({
  counterpartyName,
  counterpartyAvatarPath,
  counterparty,
  backHref,
  status,
  progress,
  menu,
}: {
  counterpartyName: string;
  counterpartyAvatarPath?: string | null;
  /** Trust facts for the person line: ID check and rating. */
  counterparty?: ContractChatCounterparty | null;
  /**
   * @deprecated The item and its status moved into the step card (`progress`).
   * Kept so existing call sites compile.
   */
  subject?: ContractChatSubject | null;
  /**
   * @deprecated No longer shown (2026-11-27): "Offline" beside the name read as the
   * other person being offline.
   */
  connectionStatus?: 'ok' | 'error' | string;
  backHref?: string;
  /** @deprecated See `subject`. */
  status?: ReactNode;
  /** @deprecated See `subject`. */
  assurance?: ReactNode;
  /**
   * `ContractStepCard`: which step, how far along, and any running clock. Drawn
   * under the person line in the thread layout only; in the split, the contract
   * header above carries it and the details pane is already on screen.
   */
  progress?: ReactNode;
  /** Secondary actions about the PERSON, e.g. reporting them. */
  menu?: ReactNode;
}) {
  const split = useContractSplit();

  // WHO, THEN WHAT (UX review 2026-11-27). The bar used to be one line carrying
  // the item title, its price, the status badge, the other person's name and an
  // (i); the name was the faintest thing on it. Every marketplace chat we looked
  // at (eBay, Depop, Vinted, Vestiaire) puts the person and the item on separate
  // lines. The person is line 1, with the two facts that say whether to trust
  // them; the step card under it is the item and where the contract is.
  const rating =
    counterparty?.rating != null && counterparty.ratingCount > 0
      ? `★ ${counterparty.rating.toFixed(1)} (${counterparty.ratingCount})`
      : 'No ratings yet';

  return (
    <header
      className={cn(
        // A TINTED BAND in the thread layout (2026-11-27), so the person line and
        // the white step card read as the room's header rather than the top of the
        // conversation. The split keeps the card surface: there the contract header
        // above already separates it.
        'sticky top-0 z-10 shrink-0 border-b bg-card px-group py-2 max-lg:bg-muted/70 max-lg:pb-2.5',
        'max-md:pl-[max(1rem,env(safe-area-inset-left))] max-md:pr-[max(1rem,env(safe-area-inset-right))]',
      )}
    >
      <div className="flex items-center gap-cozy">
        {backHref ? (
          <Link
            href={backHref}
            transitionTypes={['nav-back']}
            aria-label="Back"
            // `size-9 -ml-2.5`, matching `ChatThread`'s bar — see the note there.
            className="-ml-2.5 inline-flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-md border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-ring md:hidden"
          >
            <Icon icon={CaretLeftIcon} className="size-5" aria-hidden />
          </Link>
        ) : null}

        <Avatar avatarPath={counterpartyAvatarPath} displayName={counterpartyName} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
            {counterpartyName}
          </h2>
          {/* Always drawn, so the bar does not grow when the facts arrive. */}
          {/* Spaced, not dotted (2026-11-27). */}
          <p className="mt-0.5 flex min-w-0 items-center gap-x-cozy text-meta text-muted-foreground">
            {counterparty?.verified ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-trust">
                <Icon icon={SealCheckIcon} className="size-3.5" aria-hidden />
                ID verified
              </span>
            ) : counterparty ? (
              <span className="shrink-0">Not ID verified</span>
            ) : null}
            {counterparty ? <span className="truncate">{rating}</span> : null}
          </p>
        </div>

        {/* Reporting is about the person, which is what this line is, so it
            belongs here rather than in the action dock's menu. */}
        <ContractOverflowMenu>{menu}</ContractOverflowMenu>
      </div>

      {progress && !split ? <div className="mt-2">{progress}</div> : null}
      {/* The status badge, for screen readers and the e2e state reads. */}
      {status ? <span className="sr-only">{status}</span> : null}
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
  counterparty,
  placeholder = 'Message about the handover…',
  emptyHint = 'Use chat to coordinate. Only the saved terms are binding.',
  subject,
  actions,
  menu,
  backHref,
  status,
  assurance,
  progress,
  shipment = null,
  saleContext = null,
  className,
}: ContractChatProps) {
  const {
    messages,
    historyReady,
    connectionStatus,
    addOptimistic,
    settleOptimistic,
  } = useConversationRealtime(conversationId);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousCount = useRef(messages.length);
  // Mirrors `isNearBottom` for the ResizeObserver below, which is created once and
  // would otherwise read the value from its first render forever. Written where the
  // state is written, not during render.
  const isNearBottomRef = useRef(true);

  // Follow the newest message only while the reader is already near the
  // bottom; otherwise surface a "new messages" affordance instead of yanking
  // their scroll position (demo-contract-ux Req 1.5).
  //
  // The PIN is a layout effect so it lands before paint: as a passive effect the room
  // drew its history scrolled to the top for one frame when it arrived, then snapped to
  // the newest message, and each live message painted below the fold before the log
  // caught up with it. The read receipt stays passive — it is a network call, not
  // layout, and has no business delaying a frame.
  useLayoutEffect(() => {
    const added = messages.length - previousCount.current;
    previousCount.current = messages.length;
    const log = logRef.current;
    if (isNearBottom) {
      if (log) log.scrollTop = log.scrollHeight;
      setUnseenCount(0);
    } else if (added > 0) {
      setUnseenCount((count) => count + added);
    }
  }, [messages.length, isNearBottom]);

  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId, messages.length, isNearBottom]);

  // Keep the pin through size changes that are not new messages: signed attachment
  // URLs resolving inside bubbles that have already mounted, and the log's own box
  // shrinking when the composer grows a line or the action dock changes height. Without
  // this the newest entry slid under the dock with nothing to bring it back.
  useEffect(() => {
    const log = logRef.current;
    const content = contentRef.current;
    if (!log || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(content);
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const log = event.currentTarget;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    const nearBottom = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    isNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
    if (nearBottom) setUnseenCount(0);
  }

  function scrollToLatest() {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    isNearBottomRef.current = true;
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
        // The card edge everywhere else (`.surface`, from `md`): a hairline shadow and a
        // tight drop, never a border AND a shadow, which is the "ghost card" tell.
        'surface-md flex min-h-0 flex-1 flex-col overflow-hidden bg-card md:rounded-xl',
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
        counterparty={counterparty}
        subject={subject}
        connectionStatus={connectionStatus}
        backHref={backHref}
        status={status}
        assurance={assurance}
        progress={progress}
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
          // `pb-6`, NOT the `p-cozy` bottom. The log's clusters are `gap-6` apart, so
          // 12px of bottom padding left the newest entry closer to the composer's rule
          // than to the entry above it — and the newest entry is a contract update as
          // often as it is a message, which is a line of grey text with nothing else to
          // separate it from the dock below. Matching the cluster gap gives the last
          // thing in the transcript the same air as everything between.
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain p-cozy pb-6',
            'max-md:pl-[max(1rem,env(safe-area-inset-left))] max-md:pr-[max(1rem,env(safe-area-inset-right))]',
          )}
          role="log"
          tabIndex={0}
          aria-label={`Chat with ${counterpartyName}`}
          aria-live={historyReady ? 'polite' : 'off'}
          aria-busy={!historyReady}
        >
          {/* NOTHING UNTIL THE HISTORY HAS LOADED. This hook reads history on the
              client, so for the first round trip `messages` is empty — and the log
              used to say so, drawing the empty-thread hint ("Use chat to
              coordinate…") into a room that may hold fifty messages, then swapping
              it for the transcript. A blank log for that moment is honest; an empty
              state is a claim that turns out false.

              `|| messages.length > 0`, not `historyReady` alone: the hook renders the
              fetched backlog one task BEFORE it flips `historyReady`, so the backlog
              lands while `aria-live` is still off. Gating on the flag alone would mount
              the whole transcript in the same commit that turns announcements on.

              The wrapper is what the ResizeObserver above watches, and it centres
              the genuine empty hint the way `ChatThread`'s column does. */}
          <div
            ref={contentRef}
            className={cn(
              'flex min-h-full flex-col',
              messages.length === 0 && 'justify-center',
            )}
          >
            {historyReady || messages.length > 0 ? (
              <MessageLog
                conversationId={conversationId}
                messages={messages}
                currentUserId={currentUserId}
                counterpartyName={counterpartyName}
                counterpartyAvatarPath={counterpartyAvatarPath}
                emptyHint={emptyHint}
                shipment={shipment}
                saleContext={saleContext}
                showNames
              />
            ) : null}
          </div>
        </div>
        {!isNearBottom && unseenCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            // A floating capsule over the log, Instagram's "new messages" chip: it is
            // not a control in the page's grid but a marker on the conversation, so it
            // takes the chat's pill shape rather than the 6px control corner.
            className="absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 touch-manipulation items-center gap-tight rounded-full bg-primary pl-cozy pr-group text-body font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-foreground"
          >
            <Icon icon={CaretDownIcon} className="size-3.5" aria-hidden />
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
