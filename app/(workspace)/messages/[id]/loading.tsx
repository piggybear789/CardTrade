// app/(workspace)/messages/[id]/loading.tsx
//
// Conversation thread: flush shell so the composer stays in the viewport, matching
// ChatThread (person bar, item context, bubbles, composer).
//
// A LEAF LOADER, AND THERE IS DELIBERATELY NOTHING AT `messages/`. A `loading.tsx` is the
// Suspense fallback for its segment AND EVERY DESCENDANT, so one placed at a segment with
// child routes will stand in for pages it looks nothing like. That slot used to hold the
// inbox-list skeleton, which is how clicking from one conversation to the next drew a
// full-width card of nine wide inbox rows in front of a two-pane room. `(inbox)/` owns
// that skeleton now and this owns the thread's; neither can reach the other.
//
// With `messages/` empty, a thread-to-thread navigation has no boundary above it at all,
// which is the better answer rather than a compromise: the conversation you are reading
// stays on screen until the next one is ready. A correct page held for a moment beats a
// placeholder that is right about nothing but the chrome.
//
// THE LIST PANE IS RESERVED HERE TOO. From `lg` the real page puts the thread beside a
// 21rem list (`InboxTwoPane`); a skeleton that draws only the thread renders it full
// width and then shunts it 21rem sideways the moment data lands.
//
// Everything about the aside except its contents is `InboxTwoPane`'s, term for term —
// widths, borders, the shared bar height, the scroll container and its reserved scrollbar
// gutter. The two must be edited together, as with `MarketplaceShell` and its own skeleton.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  ChatThreadSkeleton,
  InboxRowSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
import { PANE_BAR_MIN_H } from '@/components/messages/threadGeometry';
import { cn } from '@/lib/utils';

/**
 * Rows that fill the pane, which is the full flush height — roughly 835px on a 900px
 * window, less the 68px bar. A compact rail row is ~97px (`py-3.5` and a focus-ring
 * border around a three-line text column), so eight of them reach the bottom. Seven
 * eighty-pixel rows used to stop ~230px above it, inside a pane with a visible right
 * border: the placeholder read as a short list rather than a loading one.
 */
const RAIL_ROWS = 8;

export default function ConversationLoading() {
  return (
    <MarketplaceShellSkeleton title="Messages" flush fill contentOwnsBottomPadding>
      <div className="flex min-h-0 flex-1 items-stretch">
        <aside
          className="hidden min-w-0 flex-col border-r border-border bg-card lg:flex lg:w-[21rem] lg:shrink-0 xl:w-[23rem]"
          aria-hidden
        >
          {/* THE REAL BAR, not a placeholder for it. `InboxTwoPane` prints a static
              "Inbox" heading here — it is not data, so there is nothing to wait for and
              nothing to fade in. Bar height comes from the one constant both pane bars
              use, so the two bottom borders read as a single line across the split while
              the thread is still loading, exactly as they do afterwards.

              The unread count that sits opposite IS data, so it is left out rather than
              guessed. It is `shrink-0 text-meta` in a bar pinned by `min-h`, so its
              arrival moves nothing. */}
          <div
            className={cn(
              'flex shrink-0 items-center justify-between gap-snug border-b bg-card px-cozy py-2.5',
              PANE_BAR_MIN_H,
            )}
          >
            <h2 className="truncate text-lead font-semibold leading-tight tracking-tight">
              Inbox
            </h2>
          </div>
          {/* `overflow-y-auto overscroll-contain [scrollbar-gutter:stable]` and a `ul`
              carrying the dividers — the real pane's nesting, class for class. The gutter
              is the load-bearing one: a placeholder cannot know how many conversations
              are coming, so it cannot know whether the real pane will draw a scrollbar,
              and a ~15px change in the pane's inner width moves every row sideways.
              Reserving it on both sides makes the question moot. See `InboxTwoPane`. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {/* `variant="rail"` — the pane's OWN row. `InboxTwoPane` hands the real list
                the same switch, because the wide `/messages` row puts a 48px thumbnail,
                an avatar, a name, a pill and a clock on one line and none of that
                survives 21rem. Asking for the default here drew the wide row instead: a
                different arrangement, 17px shorter, eight rows deep. */}
            <ul role="list" className="divide-y divide-border">
              {Array.from({ length: RAIL_ROWS }, (_, index) => (
                <li key={index}>
                  <InboxRowSkeleton variant="rail" />
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatThreadSkeleton />
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
