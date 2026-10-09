// components/layout/WorkspaceSkeletons.tsx
//
// Page-shaped placeholders shared by route `loading.tsx` files. Each primitive
// mirrors a live workspace pattern (section heading, Active/Past tabs, contract
// card, inbox row) so the swap on data arrival does not jump. Catalog tiles live
// in `catalogSkeletons.tsx` so the homepage loading state does not import the
// tab strip.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
// The real contract lists' own column definition, so a placeholder cannot approximate
// a grid whose whole purpose is that cells land at the same x.
import { CONTRACT_ROW_GRID } from '@/components/account/ContractRow';
// The real tab strip's own geometry, for the same reason.
import {
  SECTION_TABS_ITEM_SHAPE,
  SECTION_TABS_NAV_SHAPE,
} from '@/components/layout/SectionFilter';
// The thread's shared measurements — bar height and horizontal inset — for the same
// reason: a placeholder that computes its own is a placeholder that shifts on swap.
import {
  MESSAGE_GUTTER,
  PANE_BAR_MIN_H,
} from '@/components/messages/threadGeometry';
import { cn } from '@/lib/utils';

export function SectionHeaderSkeleton({
  hasMobileAction = false,
  hasActions = false,
  actionsClassName = 'w-28',
  titleClassName = 'w-40',
  descriptionClassName = 'w-64',
  descriptionLines = 1,
  mobileActionClassName = 'w-36',
}: {
  /**
   * Width of the phone-only action. The real one is a content-sized `Button`, and the
   * labels differ ("Sell an item" with its glyph against "Browse marketplace"), so a
   * single `w-36` moved the left edge of every one on swap.
   */
  mobileActionClassName?: string;
  /**
   * How many lines the description wraps to from `md`. One for most headers; the
   * arbitration queue's ~150-character line wraps beside its action button, and a
   * one-line reserve stood everything under that header 22px high.
   */
  descriptionLines?: number;
  hasMobileAction?: boolean;
  /**
   * Match `SectionHeader.actions` — the slot that stays visible at every width (the
   * Operations console's hand-off to Cases, for instance). Distinct from
   * `hasMobileAction`, which is the `md:hidden` one.
   */
  hasActions?: boolean;
  actionsClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}) {
  return (
    <header className="mb-snug flex flex-row items-center justify-between gap-cozy border-b border-border pb-snug md:mb-5 md:items-end md:gap-cozy md:pb-5">
      {/* REAL LINE BOXES, and no `space-y-snug`. `SectionHeader` wraps these in a bare
          `min-w-0` div and spaces the description with `mt-tight md:mt-1.5` (4/6px), so
          the 8px here was wrong at both widths. The bars were wrong in OPPOSITE
          directions, which is why the header visibly rearranged itself on swap rather
          than simply shifting: `h-6 md:h-8` reserved 24/32px for an `h2` whose line box
          is 23.8/26.25px, so the title bar SHRANK by 5.75px on desktop, while `h-4`
          reserved 16px for a `text-body` paragraph measuring 22.4px, so the description
          bar GREW by 6.4px underneath it. */}
      {/* `min-h-10` below `md`, as `SectionHeader` reserves for its phone action. */}
      <div className="flex min-h-10 min-w-0 flex-col justify-center md:block md:min-h-0">
        <TextLines className="text-subhead md:text-head" widths={[titleClassName]} />
        <TextLines
          className="mt-tight hidden text-body md:mt-1.5 md:block"
          widths={[
            ...Array.from({ length: descriptionLines - 1 }, () => 'w-full'),
            cn('max-w-full', descriptionClassName),
          ]}
        />
      </div>
      {/* `h-10 md:h-9`, `Button`'s default size at BOTH widths; a bar taller or
          shorter than the button it stands in for moves the header rule and
          everything under it on swap. Callers that render a `size="sm"` action
          override the height through `actionsClassName`. */}
      {hasActions ? (
        <div className="flex shrink-0 gap-snug">
          <Skeleton className={cn('h-10 shrink-0 rounded-md md:h-9', actionsClassName)} />
        </div>
      ) : null}
      {hasMobileAction ? (
        <Skeleton
          className={cn('h-10 shrink-0 rounded-md md:hidden', mobileActionClassName)}
        />
      ) : null}
    </header>
  );
}

/**
 * Workspace tab strip — drawn from `SectionTabs`' own shape constants, so it occupies
 * an identical box.
 *
 * `labels` RATHER THAN A COUNT, and that is the fix rather than a refinement. A count
 * can only produce equal fixed-width tabs, and the real strip's tabs are sized by their
 * text: "Active" and "Needs you" are not the same width, and four tabs at a hardcoded
 * 96px came to 396px against the ~343px a 375px phone leaves. The strip then either
 * overflowed or widened the whole content column until data landed. Passing the real
 * labels reserves the real widths.
 *
 * Each tab gets a count bar too, because `ContractFilter` renders one on every tab and
 * it is inside the same line box.
 */
export function SectionFilterSkeleton({
  labels,
  /**
   * Match `SectionTab.count` — pass `false` for a strip whose tabs count nothing, so
   * the placeholder does not reserve a figure that never arrives.
   *
   * Defaults true because every strip in the app today counts: `SectionFilter`,
   * `ContractFilter`, the Operations console and the arbitration queue all pass a
   * `count` on every tab. The escape hatch exists for the first one that does not.
   */
  counts = true,
}: {
  labels: readonly string[];
  counts?: boolean;
}) {
  return (
    <div className={SECTION_TABS_NAV_SHAPE} aria-hidden="true">
      {labels.map((label) => (
        <div key={label} className={SECTION_TABS_ITEM_SHAPE}>
          {/* The label sized to its own text. `ch` tracks the glyph count without
              needing a per-label lookup, and the strip's `shrink-0` means an
              approximate width still reserves an honest total. */}
          <Skeleton
            className="h-[0.9em] rounded-sm"
            style={{ width: `${Math.max(4, label.length)}ch` }}
          />
          {counts ? <Skeleton className="h-[0.9em] w-3 rounded-sm" /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * One row of `TradesSection` / `CashSalesSection`.
 *
 * Laid out on `CONTRACT_ROW_GRID` — the real list's own column definition, imported
 * rather than approximated. Those lists used to be a stack of `rounded-xl` cards and
 * this placeholder described that shape; they are now one bordered table with aligned
 * columns, and a placeholder cannot be "close enough" to a grid whose whole purpose is
 * that things land at the same x.
 */
function ContractRowSkeleton({
  titleLines,
  className,
}: {
  titleLines: 1 | 2;
  className?: string;
}) {
  return (
    <li className={cn(CONTRACT_ROW_GRID, 'px-group py-cozy', className)}>
      <Skeleton className="size-12 shrink-0 rounded-md md:size-14" />
      <div className="min-w-0">
        {/* Title/meta/next-step runs are texture inside this `min-w-0` cell, so they
            draw from the canonical set. The two-line-vs-one-line distinction is kept
            (it is what makes a trade row taller than a sale row), and the first line
            of a two-line title stays `w-full` with a `w-1/3` taper. */}
        <TextLines
          className="text-body"
          widths={titleLines === 2 ? ['w-full', 'w-1/3'] : ['w-2/3']}
        />
        {/* The meta line. Below `md` it also carries the status badge, which has no
            column of its own at that width — `rounded-md` because that is the shape
            `Badge` draws, and `h-6 w-20` is its honest reserve. */}
        <div className="mt-0.5 flex items-center gap-cozy">
          <TextLines className="min-w-0 flex-1 text-meta" widths={['w-1/3']} />
          <Skeleton className="h-6 w-20 shrink-0 rounded-md md:hidden" />
        </div>
        {/* The next-step line, which below `md` sits inside this cell. */}
        <TextLines className="mt-tight text-meta md:hidden" widths={['w-2/3']} />
      </div>
      {/* Its own column from `md`. Two lines, because the step sentences are clamped
          at two and most of them use both. */}
      <div className="hidden min-w-0 md:block">
        <TextLines className="text-meta" widths={['w-full', 'w-1/2']} />
      </div>
      <div className="hidden justify-end md:flex">
        <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
      </div>
    </li>
  );
}

export function ContractCardListSkeleton({
  count = 5,
  /**
   * Rows to draw from `md`, where the fold is much deeper.
   *
   * TWO COUNTS, BECAUSE ONE CANNOT BE RIGHT AT BOTH WIDTHS. A wide row is 80px —
   * `py-cozy` either side of a 56px thumb — and a 1440x900 desktop leaves roughly
   * 667px under the section header and tab strip. Four rows is 354px of that,
   * including the table header: the placeholder STOPPED halfway up the viewport,
   * and then the real list carried on past the fold, so the one load where the
   * skeleton is supposed to hold the page still was the load where the page grew
   * under the reader. Nine rows overshoot the fold instead, which costs nothing —
   * the excess is below the crease at a scroll position that is still at the top —
   * whereas undershooting is visible every time.
   *
   * The phone count is left alone: five 72px rows already fill a phone, and
   * drawing nine there would be four rows of motion nobody sees.
   */
  desktopCount = 9,
  /**
   * Trades label both sides of the swap ("X ↔ Y") in a two-line clamp that, at phone
   * width, almost always uses both lines.
   */
  titleLines = 1,
}: {
  count?: number;
  desktopCount?: number;
  titleLines?: 1 | 2;
}) {
  const rows = Math.max(count, desktopCount);
  // The frame `ContractRowTable` draws, term for term: one bordered card, a header row
  // from `md`, hairline-divided rows inside.
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      {/* The header cells are `.market-label` — an 11px arbitrary size with NO
          line-height of its own, so its line box inherits the surrounding `text-body`
          leading and comes out near 17.6px, not the 12px an `h-3` reserved. Four or five
          rows hang off this band, so the whole desktop table sat ~5px high for the load.
          `.market-label` on the wrapper hands `TextLines` the real box. */}
      <div
        className={cn(
          CONTRACT_ROW_GRID,
          'market-label hidden border-b border-border bg-muted px-group py-snug md:grid',
        )}
      >
        <span />
        <TextLines widths={['w-16']} />
        <TextLines widths={['w-16']} />
        <TextLines className="justify-self-end" widths={['w-12']} />
      </div>
      <ul role="list" className="divide-y divide-border">
        {Array.from({ length: rows }, (_, index) => (
          <ContractRowSkeleton
            key={index}
            titleLines={titleLines}
            // `max-md:hidden` removes the overflow rows from the phone entirely
            // rather than drawing them off-screen. Safe against the `grid` in
            // `CONTRACT_ROW_GRID` for the same reason `CatalogGridSkeleton` can do
            // it: Tailwind emits variant rules after unprefixed ones, so inside the
            // media query `hidden` wins the `display` conflict.
            className={index >= count ? 'max-md:hidden' : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One LISTING GROUP of `OffersSection`.
 *
 * Offers do NOT use `MobileList`: the real list is `space-y-cozy` over bordered cards
 * at every width, phone included. Reusing the contract-row placeholder here drew flat
 * full-bleed rows on the page colour, so the whole list gained a border, a shadow,
 * 12px of inner padding and 12px gaps on swap.
 *
 * The card is a GROUP now, not a negotiation: the item's photo and title are stated
 * once in a tinted header strip and the negotiations are divided rows beneath it. One
 * row per group is drawn here, because that is the common shape — a member with three
 * offers on one listing is the case the grouping exists for, not the case to reserve
 * space for.
 */
function OfferRowSkeleton() {
  return (
    <Card className="overflow-hidden">
      {/* The header strip: 40px thumb, title, no badge. */}
      <div className="flex items-center gap-cozy border-b border-border bg-muted/50 px-cozy py-snug">
        <Skeleton className="size-10 shrink-0 rounded-md" />
        <TextLines className="min-w-0 flex-1 text-body" widths={['w-2/3']} />
      </div>
      {/* One negotiation: amount + badge, role line, then the chain. The text runs are
          texture (the badge below carries the row height); they draw from the canonical
          set while the thumb and the baseline-bearing badge box keep their geometry. */}
      <div className="px-cozy py-group">
        <div className="flex items-baseline justify-between gap-snug">
          <TextLines className="min-w-0 text-lead" widths={['w-1/3']} />
          {/* A TEXT-BEARING badge box, not an empty `h-6` slab. This row is
              `items-baseline`, and an empty block's baseline is its bottom edge, so the
              slab sat with its foot on the amount's baseline and stood the row ~3px
              tall — every card in the list ran long. The invisible word gives the box
              a real baseline, and its height comes from `Badge`'s own padding. */}
          <Skeleton className="inline-flex shrink-0 rounded-md border border-transparent px-2.5 py-0.5 text-meta">
            <span className="invisible">Pending</span>
          </Skeleton>
        </div>
        <TextLines className="mt-0.5 text-body" widths={['w-2/3']} />
        <TextLines className="mt-snug text-meta" widths={['w-1/3']} />
      </div>
    </Card>
  );
}

export function OfferCardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-cozy">
      {Array.from({ length: count }, (_, index) => (
        <OfferRowSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * One inbox row, in the same two variants `InboxThreadList` itself has.
 *
 * `page` — `/messages`: the compact row below `md`, the wide row from `md`.
 *
 * `rail` — the 21rem pane beside an open thread. `InboxTwoPane` passes
 * `variant="rail"` to the real list, which draws the COMPACT row AT EVERY WIDTH and
 * insets it `px-cozy`, because the wide row puts a 48px thumbnail, an avatar, a name, a
 * pill and a clock on one line and none of that survives 21rem.
 *
 * THE MISSING VARIANT WAS A VISIBLE TEAR ON EVERY CLICK BETWEEN TWO CONVERSATIONS.
 * The thread route's loader had no rail shape to ask for, so at `lg` the pane got the
 * `md:flex` WIDE row: a leading 48px square with two text lines beside it, 80px tall,
 * standing in for a compact row that is a leading round avatar, THREE stacked lines and a
 * trailing square, 97px tall. Seventeen pixels and a different arrangement, eight rows
 * deep — the list did not shift so much as get replaced by a different list.
 *
 * NO LOADER DRAWS `rail` NOW. The pane moved into `messages/(thread)/layout.tsx`, which
 * a thread switch does not re-render, so the real list stays on screen and there is no
 * placeholder to keep in step with it. Kept, with its geometry, for a pane that ever
 * needs one again.
 */
export function InboxRowSkeleton({
  variant = 'page',
}: {
  variant?: 'page' | 'rail';
} = {}) {
  // `MobileThreadRow`'s own box, and three things here were stale against it.
  // `items-center`, NOT `items-start`: the real row centres, and centring is what let it
  // drop the `mt-0.5` nudge this placeholder still had on the avatar. And
  // `border border-transparent` is the focus-ring reserve every row carries because it is
  // a link — without it each row was 2px short, all the way down the list.
  const compact = (
    <div
      className={cn(
        'flex min-h-11 items-center gap-cozy border border-transparent py-3.5',
        // In the rail this IS the row at every width and carries the pane's inset. On
        // `/messages` it is the phone row and the wide one below replaces it at `md`.
        variant === 'rail' ? 'px-cozy' : 'md:hidden',
      )}
    >
      {/* Three lines of real type — `text-lead`, `text-body`, `text-meta` — not
          `h-4` + `h-3` + `h-3`. The old bars came to 56px against the row's
          65.6px, so a six-thread inbox stood ~60px short and slid down on swap. */}
      {/* The `size-12 rounded-full` avatar sets no height — the three-line text column
          beside it is taller — so by the texture test it is decorative. It is KEPT as a
          same-size neutral reserve anyway, because the comments above record this box as
          part of the row's measured 65.6px height contribution and the safe move is to
          touch only the text widths. Those three runs draw from the canonical set. */}
      <Skeleton className="size-12 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <TextLines className="text-lead" widths={['w-1/3']} />
        <TextLines className="mt-0.5 text-body" widths={['w-2/3']} />
        <TextLines className="mt-0.5 text-meta" widths={['w-1/3']} />
      </div>
      {/* NO TRAILING SQUARE, and it stays out: the real row draws one only for a thread
          that carries a listing or a trade. It is `shrink-0` beside a text column taller
          than it is, so leaving it out cannot change the row's height — only the width
          of placeholder bars that are fractions anyway. */}
    </div>
  );

  if (variant === 'rail') return compact;

  return (
    <>
      {compact}
      {/* The desktop row, now on real line boxes and with the two things it was
          missing. `InboxThreadList`'s wide row is ONE 24px line — a `size-6` avatar,
          the name at `text-lead`, a status pill, the time pushed right — over a
          `mt-0.5 text-body` preview. This drew neither the avatar nor the pill, spaced
          the preview with `space-y-snug` where the real gap is `mt-0.5`, and reserved
          `h-4`/`h-3` for a 24px and a 22.4px line. That is ~18px short PER ROW, so a
          seven-thread inbox stood about 125px short and the whole list slid up on
          swap. */}
      {/* The wide row's `size-6 rounded-full` avatar and `h-5 w-16 rounded-full` pill
          are kept as same-size neutral reserves (the thumb and pill carry the line's
          height); only the text runs are normalized to the canonical set. */}
      <div className="hidden items-center gap-cozy p-group md:flex">
        <Skeleton className="size-12 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-snug">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <TextLines className="min-w-0 flex-1 text-lead" widths={['w-1/3']} />
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            <TextLines className="ml-auto shrink-0 text-meta" widths={['w-1/3']} />
          </div>
          <TextLines className="mt-0.5 text-body" widths={['w-2/3']} />
        </div>
      </div>
    </>
  );
}

export function NotificationRowSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    // `border border-transparent` because the real row is a button that reserves
    // one for its focus ring; without it the placeholder is 2px short per row.
    <div
      className={cn(
        'flex items-start gap-cozy border border-transparent px-group py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-snug">
          <TextLines className="min-w-0 flex-1 text-body" widths={['w-1/3']} />
          <TextLines className="shrink-0 text-meta" widths={['w-1/3']} />
        </div>
        <TextLines className="mt-0.5 text-body" widths={['w-2/3']} />
      </div>
    </div>
  );
}

export function ChatThreadSkeleton() {
  return (
    <section
      // `bg-card` at every width, matching the real thread. The column is ONE surface:
      // when the log fell through to the tinted page background, this placeholder and
      // the page it stood in for both showed three bands in one column.
      className="flex min-h-0 w-full flex-1 flex-col bg-card"
      aria-label="Loading conversation"
    >
      {/* Matches the real thread's compact subject bar, scroll region, and
          self-contained composer. Contract state determines whether a small
          pre-contract note appears, so the loading shell reserves no note.

          Bar height comes from the shared constant, not a local guess — the real bar
          has to line up with the inbox pane's, and so does this. */}
      <header
        className={cn(
          'flex shrink-0 items-center gap-cozy border-b py-2.5',
          PANE_BAR_MIN_H,
          MESSAGE_GUTTER,
        )}
      >
        <Skeleton className="-ml-2.5 size-9 shrink-0 rounded-full md:hidden" />
        <Skeleton className="size-9 shrink-0 rounded-md" />
        {/* `text-lead leading-tight` over the meta row, and NO `space-y`. `ChatThread`'s
            h2 and its meta line are adjacent blocks, so the `space-y-1.5` that was here
            invented 6px; the bars themselves were `h-4`/`h-3` against 20px and 22.8px
            line boxes. `leading-tight` overrides the type token's own line-height on the
            TITLE and must be carried here too, or the placeholder over-reserves.

            THE META LINE IS `mt-0.5 text-body` WITHOUT `leading-tight`, which is the
            opposite of the title and is not an inconsistency — it is what the real bar
            does. `PANE_BAR_MIN_H`'s note records why: that line was rebuilt as a flex row
            to hold a status badge, which meant dropping the cap and `leading-tight` and
            adding `mt-0.5`. Carrying the old form here left the block 7px shorter than the
            real one and, in an `items-center` bar, sitting ~3.5px high. */}
        <div className="min-w-0 flex-1">
          <TextLines className="text-lead leading-tight" widths={['w-1/3']} />
          <TextLines className="mt-0.5 text-body" widths={['w-1/3']} />
        </div>
        {/* The thread CTA is `Button size="sm"`: 36px on phones, 32px from `md`. */}
        <Skeleton className="h-9 w-24 shrink-0 rounded-md md:h-8" />
      </header>
      {/* The log bubbles are texture inside this `flex-1` region: one uniform `h-12`
          height and a two-width alternating set (incoming `w-2/3`, outgoing `w-1/2
          ml-auto`), with the four-bubble count, `rounded-2xl` and `space-y-cozy`
          unchanged. Same calm treatment as `ContractRoomSkeleton`'s logs. */}
      <div className={cn('min-h-0 flex-1 space-y-cozy pt-5', MESSAGE_GUTTER)}>
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
      </div>
      {/* NO STANDING NOTE. A bordered band used to sit here for the "nothing is
          held while you are only talking" line, drawn unconditionally. The real
          thread renders it only when the conversation is NOT under a contract,
          which every trade and sale thread is — so on those it was a ~41px band
          that vanished, and on a listing thread the copy wraps to two lines
          against the 16px that was reserved. `loading.tsx` cannot know which
          kind of thread it is about to show, so it reserves neither. */}
      {/* The composer owns the complete symmetric band, matching ChatThread. */}
      <div className={cn('shrink-0 border-t py-group', MESSAGE_GUTTER)}>
        {/* 44px touch controls on phones, 36px from `md` with square-ish corners —
            `MessageComposer`'s `icon-lg` buttons and field. A 44px row at every width
            put the desktop composer's top edge ~8px off on swap. */}
        <div className="flex items-center gap-snug">
          <Skeleton className="size-11 shrink-0 rounded-full md:size-9 md:rounded-md" />
          <Skeleton className="h-11 min-w-0 flex-1 rounded-2xl md:h-9 md:rounded-md" />
          <Skeleton className="size-11 shrink-0 rounded-full md:size-9 md:rounded-md" />
        </div>
      </div>
    </section>
  );
}
