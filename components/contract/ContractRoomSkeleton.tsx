// components/contract/ContractRoomSkeleton.tsx
//
// The loading placeholder for BOTH contract rooms — `/sales/[id]` and `/trades/[id]` —
// kept beside the components it stands in for, so the two are edited together.
//
// It used to live in `components/layout/WorkspaceSkeletons.tsx`, a long way from
// `ContractChatBar`, `ContractActionCard` and `MessageComposer`, and it had drifted from
// all three. Measured against the real room:
//
//   - The chat bar was ~8px short on a phone and ~17px short on a desktop. The real bar
//     is a title line OVER a subline that carries a status `Badge` (22.8px, a hair
//     taller than the text beside it); the phone placeholder drew a `leading-tight` text
//     line there and the desktop one drew no subline at all.
//   - The composer was 4px tall on a phone and 8px tall on a desktop: `pt-group` and
//     `py-group` against the compact composer's `p-cozy`. Its button corners were also
//     inverted — round on a desktop and square on a phone, the opposite of the real one.
//   - The desktop dock was 4.4px short: it reserved one 40px control, but from `md` the
//     dock is a title line over a detail line beside a 32px control.
//   - Between 768 and 1023 the thread drew the phone's back chevron and no card frame.
//     `ContractChat` is a bordered card from `md` (only its `max-md:` rules strip the
//     frame) and the back link is `md:hidden`.
//
// The three breakpoints are unchanged and still matter: the identity card is `md`
// (`DesktopOnly`), the details/chat split is `lg` (`useContractSplit`).
//
//   below md    thread alone — bar, log, action dock, composer
//   md to lg    identity card above a framed thread, details still behind a sheet
//   lg and up   identity card above the details/chat split, both panes full height
//
// Rendered by the routes' `loading.tsx` only; the conversation panel reuses
// `ContractComposerPlaceholder` while a legacy contract's thread is still opening.

import { Card } from '@/components/ui/card';
import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A `Badge`-sized box. The geometry is the badge's own — `border px-2.5 py-0.5
 * text-meta` around a line of text — so the height comes from the type scale rather
 * than from a number restated here (22.8px today).
 */
function BadgeSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        'inline-flex shrink-0 rounded-md border border-transparent px-2.5 py-0.5 text-meta',
        className,
      )}
    >
      <span className="invisible">Status</span>
    </Skeleton>
  );
}

/**
 * `ContractChatBar`, term for term: `px-group py-2.5`, a back control below `md`, a
 * 36px subject thumbnail, then the title over the price · status · person subline.
 */
function ChatBarSkeleton() {
  return (
    // The real bar's safe-area gutters too, or on a notched phone in landscape the bar's
    // contents slid sideways by the inset on swap.
    <div className="flex shrink-0 items-center gap-cozy border-b bg-card px-group py-2.5 max-md:pl-[max(1rem,env(safe-area-inset-left))] max-md:pr-[max(1rem,env(safe-area-inset-right))]">
      <Skeleton className="-ml-2.5 size-9 shrink-0 rounded-full md:hidden" />
      <Skeleton className="size-9 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        {/* Title then the price · status · person subline. The two text runs are
            texture inside the `flex-1` column — the badge carries the subline's
            height — so they collapse to the canonical set; the `BadgeSkeleton` keeps
            its honest badge height. */}
        <TextLines className="text-lead leading-tight" widths={['w-1/3']} />
        <div className="mt-0.5 flex min-w-0 items-center gap-snug text-body">
          <TextLines className="shrink-0" widths={['w-1/3']} />
          <BadgeSkeleton />
          <TextLines className="min-w-0 flex-1" widths={['w-1/3']} />
        </div>
      </div>
    </div>
  );
}

/**
 * `ContractActionCard appearance="dock"`: `px-cozy py-snug` around a title, a detail
 * line from `md`, and the control (40px on touch, 36px from `md`) on the right.
 */
function ActionDockSkeleton() {
  return (
    <div className="relative z-10 shrink-0 border-t bg-card">
      <div className="flex items-center gap-x-cozy px-cozy py-snug">
        {/* Title over an `md`-only detail line. Both are texture inside the `flex-1
            basis-0` column, so they draw from the canonical set; the 40/36px control
            beside them keeps its reserve. */}
        <div className="min-w-0 flex-1 basis-0">
          <TextLines className="text-lead leading-tight" widths={['w-2/3']} />
          <TextLines className="mt-0.5 hidden text-body md:block" widths={['w-2/3']} />
        </div>
        <Skeleton className="h-10 w-28 shrink-0 rounded-md md:h-9" />
      </div>
    </div>
  );
}

/**
 * The compact `MessageComposer`: `border-t p-cozy`, flush to the edges with no bottom
 * inset below `md`, around an `icon-lg` attach button, a one-line field and send.
 *
 * Exported because `ContractConversationPanel` draws it while a thread is still being
 * opened. Without it the composer arrived after the thread did and lifted the action
 * dock by its own height.
 */
export function ContractComposerPlaceholder() {
  return (
    <div
      // The compact composer's own phone gutters: the safe-area insets, which are 0 on
      // a portrait phone and the notch width in landscape.
      className="shrink-0 border-t p-cozy max-md:pb-0 max-md:pl-[env(safe-area-inset-left)] max-md:pr-[env(safe-area-inset-right)]"
      aria-hidden="true"
    >
      <div className="flex items-center gap-snug">
        <Skeleton className="size-11 shrink-0 rounded-md max-md:rounded-full md:size-9" />
        <Skeleton className="h-11 min-w-0 flex-1 rounded-md max-md:rounded-2xl md:h-9" />
        <Skeleton className="size-11 shrink-0 rounded-md max-md:rounded-full md:size-9" />
      </div>
    </div>
  );
}

/** Contract room placeholder for `/sales/[id]` and `/trades/[id]`. */
export function ContractRoomSkeleton() {
  return (
    // The room root's own class list — see `CashSaleView` / `TradeContract` for the
    // `5rem` height budget it declares.
    <div className="flex min-h-0 flex-1 flex-col gap-group md:px-group md:pt-group lg:h-[calc(100dvh-5rem-1px-env(safe-area-inset-top))] lg:flex-none">
      {/* `ContractHeader`: one line inside `px-group py-cozy`. Title at `text-subhead`,
          the party line (24px `xs` avatars), then status badge and the `text-lead`
          money figure on the right.

          CALMER PARTY LINE: the real header draws two `xs` avatars with a name beside
          each, but inside this row their height is set by the `text-body` line beside
          them and by the badge, not by the 24px circles — so the circles were pure
          decorative texture. We collapse the cluster to ONE neutral `size-6 rounded-md`
          chip (a plain box, no `rounded-full` final-shape mimicry) plus a single
          `w-1/3` text run, and drop the second avatar+name pair. Nothing lines up
          against the circles, so this moves no reserved geometry. */}
      <Card className="hidden border-border shadow-sm md:block">
        <div className="flex flex-wrap items-center justify-between gap-x-group gap-y-snug px-group py-cozy">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-group gap-y-tight">
            <TextLines className="font-display text-subhead" widths={['w-1/3']} />
            <div className="flex items-center gap-x-snug">
              <Skeleton className="size-6 rounded-md" />
              <TextLines className="text-body" widths={['w-1/3']} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-cozy">
            <BadgeSkeleton className="w-24" />
            <TextLines className="text-lead" widths={['w-1/3']} />
          </div>
        </div>
      </Card>

      {/* Below the split: the thread. A full-bleed column on a phone, a bordered card
          from `md` — `ContractChat`'s frame is only stripped by `max-md:` rules. */}
      <div className="flex min-h-0 flex-1 flex-col bg-card md:overflow-hidden md:rounded-lg md:border md:border-border md:shadow-sm lg:hidden">
        <ChatBarSkeleton />
        {/* The log is `flex-1`; its height is whatever the fixed bands leave, so the
            bubbles are texture rather than geometry. Every bubble is ONE uniform
            height (`h-12`) and a two-width alternating set — incoming `w-2/3`,
            outgoing `w-1/2 ml-auto` — so the log reads calm and even. The
            `rounded-2xl`, the `gap-cozy`, the `justify-end` anchoring and the bubble
            count are unchanged. */}
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-cozy p-cozy pb-6">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
        </div>
        <ActionDockSkeleton />
        <ContractComposerPlaceholder />
      </div>

      {/* From `lg`, the split: `ContractLiveRow`'s grid, each pane `h-full` and
          bounded so it scrolls inside itself. */}
      <div className="hidden min-h-0 flex-1 flex-col gap-group lg:flex">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)] gap-group">
          {/* `ContractDetailList`: one full-height card, a `min-h-11` tab strip, then
              the active panel at `p-group` — its `text-meta` heading, then the content
              `mt-cozy` below it. */}
          <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-border shadow-sm">
            {/* The four tab labels are texture inside `min-h-11` fixed cells — the row
                height comes from `min-h-11`, not the bar widths — so they all draw at
                a single uniform `w-12` to read even rather than as a stair-step of
                four lengths. The `min-h-11`, the `px-*` cell insets and the cell count
                are geometry and unchanged. */}
            <div className="flex min-h-11 shrink-0 items-stretch border-b px-tight sm:px-snug">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex shrink-0 items-center px-cozy text-meta">
                  <TextLines widths={['w-12']} />
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1 bg-card p-group text-body">
              <TextLines className="text-meta" widths={['w-20']} />
              {/* The six label/value rows. The label column was six different widths
                  (`w-24 w-20 w-28 w-16 w-24 w-20`) — the single biggest source of
                  visual noise in this file. Both columns are texture: the label is
                  `shrink-0` and the value is `min-w-0`, so neither width positions the
                  other row's content. All six labels now draw at one uniform `w-20`
                  and the value column stays a uniform `w-24`, so the list reads as six
                  even rows. The `space-y-group`, `items-baseline` and row count are
                  unchanged. */}
              <div className="mt-cozy space-y-group">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div
                    key={index}
                    className="flex items-baseline justify-between gap-group"
                  >
                    <TextLines className="shrink-0 text-meta" widths={['w-20']} />
                    <TextLines className="min-w-0 text-body" widths={['w-24']} />
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* `ContractChat`, `h-full` in the real row too: bar, log, the action dock it
              carries internally, then the composer. */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <ChatBarSkeleton />
            {/* Bottom-anchored: a chat log opens scrolled to the newest message. Same
                calm treatment as the phone column — one uniform `h-12` height and a
                two-width alternating set (incoming `w-2/3`, outgoing `w-1/2 ml-auto`),
                with the five-bubble count, `rounded-2xl`, `gap-cozy` and `justify-end`
                anchoring all unchanged. */}
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-cozy p-cozy pb-6">
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
            </div>
            <ActionDockSkeleton />
            <ContractComposerPlaceholder />
          </div>
        </div>
      </div>
    </div>
  );
}
