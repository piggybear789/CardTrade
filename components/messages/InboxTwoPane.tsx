// components/messages/InboxTwoPane.tsx
//
// The thread list beside the open conversation, from `lg` up.
//
// WHY THE THREAD ROUTE GREW A SECOND PANE. `/messages` and `/messages/[id]` are separate
// full-width pages, so on a desktop viewport the open conversation had the whole content
// column to itself and used almost none of it: at 1920 the composer measured 1312px and a
// bubble could run past 1000px, against a comfortable measure of roughly 550-700px. The
// column was too wide to read and too empty to look deliberate, and capping it alone would
// only have made the emptiness narrower. Putting the list where that space was is what
// makes the width do something — and it turns switching threads into one click instead of
// back-then-forward.
//
// ONLY THE THREAD ROUTE GETS THIS, deliberately. `/messages` stays a full-width list: a
// list is one of the few things that genuinely reads better wide, and it is already tuned
// per breakpoint down to the phone. Bolting a second pane onto it would have meant making
// that route flush — losing its padding and its SectionHeader — to buy nothing.
//
// The two panes are DIFFERENT WIDTHS and therefore want different rows. `InboxThreadList`
// takes a `rail` variant for this pane, which draws the compact row at every width rather
// than the wide desktop row; the wide row puts a 48px thumbnail, an avatar, a name, a
// status pill, a clock and an unread badge on one line, which does not survive 21rem.

import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { MessageSquareIcon } from '@hugeicons/core-free-icons';

import { PANE_BAR_MIN_H } from '@/components/messages/threadGeometry';
import { cn } from '@/lib/utils';

/**
 * Everything about the bar at the top of each pane EXCEPT its height, which is shared
 * with the thread's bar in `paneBar.ts` — the two borders have to meet, and each pane
 * computing its own height from its own contents is what made them miss.
 */
const PANE_BAR = 'flex shrink-0 items-center border-b bg-card px-cozy py-2.5';

export function InboxTwoPane({
  list,
  detail,
  /** Conversation count for the list pane's bar, so the pane says what it holds. */
  countLabel,
}: {
  list: ReactNode;
  detail: ReactNode;
  countLabel?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-stretch">
      {/* `hidden lg:flex` — below `lg` the thread is the whole screen and the list is a
          route away, which is right on a phone and is what the back chevron in the
          thread's bar already assumes. */}
      <aside
        aria-label="Conversations"
        className={cn(
          'hidden min-w-0 flex-col border-r border-border bg-card',
          'lg:flex lg:w-[21rem] lg:shrink-0 xl:w-[23rem]',
        )}
      >
        <div className={cn(PANE_BAR, PANE_BAR_MIN_H, 'justify-between gap-snug')}>
          <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
            Inbox
          </h2>
          {countLabel ? (
            <p className="shrink-0 text-meta text-muted-foreground">{countLabel}</p>
          ) : null}
        </div>
        {/* Scrolls on its own. The shell caps a flush route's height and clips it, so
            this pane and the message log are two independent scroll areas inside one
            non-scrolling page — which is the point of a flush route.

            `scrollbar-gutter: stable` RESERVES THE SCROLLBAR'S WIDTH WHETHER OR NOT ONE
            IS DRAWN, and that turns a data-dependent layout shift into no shift at all.
            Without it the pane is ~15px narrower once the list outgrows the viewport, so
            every row's contents move sideways — on the first realtime message that pushes
            a short list past the fold, and on every `/messages/A` -> `/messages/B` click,
            because `loading.tsx` cannot know the conversation count and so cannot know
            whether to reserve the gutter. It can now: both sides reserve it always. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          {list}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{detail}</div>
    </div>
  );
}

/**
 * What the list pane sits beside when there is no conversation open.
 *
 * Not currently routed to — `/messages` remains the full-width list — but kept with the
 * frame it belongs to so that adding a `lg` redirect later does not need it reinvented.
 */
export function InboxNoSelection() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-cozy text-center">
      <div className="max-w-72">
        <span
          className="mx-auto mb-cozy flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden
        >
          <HugeiconsIcon icon={MessageSquareIcon} className="size-5" />
        </span>
        <p className="text-body text-muted-foreground">
          Pick a conversation to read it here.
        </p>
      </div>
    </div>
  );
}
