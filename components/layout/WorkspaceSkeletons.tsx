// components/layout/WorkspaceSkeletons.tsx
//
// Page-shaped placeholders shared by route `loading.tsx` files. Each primitive
// mirrors a live workspace pattern (section heading, Active/Past tabs, catalog
// tile, contract card, inbox row) so the swap on data arrival does not jump.

import type { CSSProperties } from 'react';

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
import {
  balanceMosaicColumns,
  CATALOG_MOSAIC_GAP,
  CATALOG_TILE_GRID,
} from '@/components/listings/catalogGrid';
import { coverAspectCss, type ImageDim } from '@/lib/images/dimensions';
import { cn } from '@/lib/utils';

export function SectionHeaderSkeleton({
  hasMobileAction = false,
  hasActions = false,
  actionsClassName = 'w-28',
  titleClassName = 'w-40',
  descriptionClassName = 'w-64',
}: {
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
    <header className="mb-snug flex flex-row items-center justify-between gap-cozy border-b border-border pb-snug md:mb-5 md:items-end md:gap-3 md:pb-5">
      {/* REAL LINE BOXES, and no `space-y-2`. `SectionHeader` wraps these in a bare
          `min-w-0` div and spaces the description with `mt-tight md:mt-1.5` (4/6px), so
          the 8px here was wrong at both widths. The bars were wrong in OPPOSITE
          directions, which is why the header visibly rearranged itself on swap rather
          than simply shifting: `h-6 md:h-8` reserved 24/32px for an `h2` whose line box
          is 23.8/26.25px, so the title bar SHRANK by 5.75px on desktop, while `h-4`
          reserved 16px for a `text-body` paragraph measuring 22.4px, so the description
          bar GREW by 6.4px underneath it. */}
      <div className="min-w-0">
        <TextLines className="text-subhead md:text-head" widths={[titleClassName]} />
        <TextLines
          className="mt-tight hidden text-body md:mt-1.5 md:block"
          widths={[cn('max-w-full', descriptionClassName)]}
        />
      </div>
      {/* `h-9 md:h-8`, `Button`'s default size at BOTH widths. These were `h-10`,
          4px taller than any button this header holds, so the header rule and
          everything under it sat low for the whole load. Then the `md` height moved
          28px -> 32px with `body` at 14px, which is the `md:h-8` — a flat `h-9` was
          right on touch and 4px proud on a pointer. Callers that render a `size="sm"`
          action override the height through `actionsClassName`. */}
      {hasActions ? (
        <div className="flex shrink-0 gap-2">
          <Skeleton className={cn('h-9 shrink-0 rounded-md md:h-8', actionsClassName)} />
        </div>
      ) : null}
      {hasMobileAction ? (
        <Skeleton className="h-9 w-36 shrink-0 rounded-md md:hidden" />
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
 * Compact catalog tile — `CatalogItemCard`. Square like the real cover unless
 * `coverDim` puts it in the phone mosaic, where it takes that shape below md.
 */
export function CatalogTileSkeleton({
  coverDim,
  /**
   * Reserve the seller row. `CatalogItemCard` renders it only when the tile
   * carries a seller, which My Listings deliberately omits — every tile there
   * belongs to the viewer.
   */
  hasSeller = true,
}: {
  coverDim?: ImageDim | null;
  hasSeller?: boolean;
}) {
  const inMosaic = coverDim !== undefined;
  return (
    // Border, padding and gap are `CatalogItemCard`'s, term for term. The text
    // block used to be three bars in `space-y-1.5 px-1.5 pb-2 pt-1.5` — 70px
    // against the card's 108-132px, and inset half as far — so every tile in the
    // feed was ~40px short and the error compounded down both mosaic columns.
    // The border matters as much as the height: card and page are both white, so
    // without it the placeholder tiles had no edge at all and a hairline popped
    // in around every one of them at once.
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <Skeleton
        className={cn(
          'w-full rounded-none',
          // Square at every width, like the real cover. The `md:aspect-[3/4]`
          // that used to be here was left over from a desktop cover that is no
          // longer 3:4.
          inMosaic ? 'catalog-cover' : 'aspect-square',
        )}
        style={
          inMosaic
            ? ({ '--catalog-cover-aspect': coverAspectCss(coverDim) } as CSSProperties)
            : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-1 px-3 pb-2.5 pt-2">
        {/* Title clamps to two lines and, at this column width, almost always
            uses both. */}
        <TextLines
          className="text-body leading-normal"
          widths={['w-full', 'w-3/5']}
        />
        {/* Category · condition. */}
        <TextLines className="text-body leading-tight" widths={['w-2/5']} />
        {/* Price. The major digits are `text-head`, so this line is the tallest
            in the block. */}
        <TextLines className="text-head" widths={['w-1/2']} />
        {hasSeller ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <TextLines className="min-w-0 flex-1 text-body" widths={['w-3/5']} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A repeating run of plausible cover shapes for the phone skeleton.
 *
 * Fixed rather than random so the server and the browser draw the same
 * placeholder, and chosen to span the mosaic's clamp range — trading-card
 * portrait (63x88), square, and landscape — so the placeholder staggers the way
 * the arriving content will. A uniform square grid here would itself be the
 * layout shift the stored dimensions exist to prevent.
 */
const SKELETON_COVER_SHAPES: ImageDim[] = [
  { w: 63, h: 88 },
  { w: 1, h: 1 },
  { w: 4, h: 3 },
  { w: 4, h: 5 },
  { w: 1, h: 1 },
  { w: 63, h: 88 },
];

const skeletonDim = (tile: { dim: ImageDim }) => tile.dim;

/**
 * Catalog placeholder in both layouts.
 *
 * Unlike the live grid this renders the phone mosaic AND the md grid, hiding
 * one with CSS: a skeleton owns no view-transition names, so duplicating it is
 * free, and doing it this way keeps the placeholder correct at both breakpoints
 * without waiting for JavaScript to discover the viewport.
 */
export function CatalogGridSkeleton({ count = 12 }: { count?: number }) {
  const tiles = Array.from({ length: count }, (_, index) => ({
    index,
    dim: SKELETON_COVER_SHAPES[index % SKELETON_COVER_SHAPES.length],
  }));
  // The real balancer, so the placeholder's columns break where the content's
  // will rather than merely looking uneven.
  const columns = balanceMosaicColumns(tiles, skeletonDim);

  return (
    <>
      <div
        className={cn('grid grid-cols-2 items-start md:hidden', CATALOG_MOSAIC_GAP)}
        aria-hidden="true"
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={cn('flex min-w-0 flex-col', CATALOG_MOSAIC_GAP)}
          >
            {column.map(({ item }) => (
              <CatalogTileSkeleton key={item.index} coverDim={item.dim} />
            ))}
          </div>
        ))}
      </div>
      <div className={cn(CATALOG_TILE_GRID, 'max-md:hidden')} aria-hidden="true">
        {tiles.map((tile) => (
          <CatalogTileSkeleton key={tile.index} />
        ))}
      </div>
    </>
  );
}

/**
 * Catalog placeholder for the surfaces that are NOT the mosaic — Saved, My
 * Listings, a seller's shop — where the live grid is `CATALOG_TILE_GRID` at
 * every width and every cover is square.
 *
 * Those three routes used to reach for `CatalogGridSkeleton`, which draws the
 * phone mosaic: two independently-flowing columns of six different cover
 * shapes, standing in for a lockstep grid where both tiles in a row share one
 * height. Every tile below the first row was in the wrong place, and the whole
 * grid snapped on swap. The staggering is right for the feed and wrong here —
 * see the note on `CATALOG_TILE_GRID`.
 */
export function CatalogTileGridSkeleton({
  count = 8,
  hasSeller = true,
}: {
  count?: number;
  hasSeller?: boolean;
}) {
  return (
    <div className={CATALOG_TILE_GRID} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <CatalogTileSkeleton key={index} hasSeller={hasSeller} />
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
function ContractRowSkeleton({ titleLines }: { titleLines: 1 | 2 }) {
  return (
    <li className={cn(CONTRACT_ROW_GRID, 'px-group py-cozy')}>
      <Skeleton className="size-12 shrink-0 rounded-md md:size-14" />
      <div className="min-w-0">
        <TextLines
          className="text-body"
          widths={titleLines === 2 ? ['w-full', 'w-2/5'] : ['w-3/5']}
        />
        {/* The meta line. Below `md` it also carries the status badge, which has no
            column of its own at that width — `rounded-md` because that is the shape
            `Badge` draws. */}
        <div className="mt-0.5 flex items-center gap-cozy">
          <TextLines className="min-w-0 flex-1 text-meta" widths={['w-2/5']} />
          <Skeleton className="h-6 w-20 shrink-0 rounded-md md:hidden" />
        </div>
        {/* The next-step line, which below `md` sits inside this cell. */}
        <TextLines className="mt-1 text-meta md:hidden" widths={['w-4/5']} />
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
   * Trades label both sides of the swap ("X ↔ Y") in a two-line clamp that, at phone
   * width, almost always uses both lines.
   */
  titleLines = 1,
}: {
  count?: number;
  titleLines?: 1 | 2;
}) {
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
        {Array.from({ length: count }, (_, index) => (
          <ContractRowSkeleton key={index} titleLines={titleLines} />
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
        <TextLines className="min-w-0 flex-1 text-body" widths={['w-3/5']} />
      </div>
      {/* One negotiation: amount + badge, role line, then the chain. */}
      <div className="px-cozy py-group">
        <div className="flex items-baseline justify-between gap-snug">
          <TextLines className="min-w-0 text-lead" widths={['w-20']} />
          <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
        </div>
        <TextLines className="mt-0.5 text-body" widths={['w-4/5']} />
        <TextLines className="mt-snug text-meta" widths={['w-2/5']} />
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

export function InboxRowSkeleton() {
  return (
    <>
      {/* Three lines of real type — `text-lead`, `text-body`, `text-meta` — not
          `h-4` + `h-3` + `h-3`. The old bars came to 56px against the row's
          65.6px, so a six-thread inbox stood ~60px short and slid down on swap.
          The trailing square is gone: the real row draws it only for a thread
          that carries a listing or a dispute, so an unconditional one guaranteed
          the wrong text width on every plain conversation. */}
      <div className="flex min-h-11 items-start gap-3 py-3.5 md:hidden">
        <Skeleton className="mt-0.5 size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <TextLines className="text-lead" widths={['w-1/3']} />
          <TextLines className="mt-0.5 text-body" widths={['w-3/4']} />
          <TextLines className="mt-0.5 text-meta" widths={['w-12']} />
        </div>
      </div>
      {/* The desktop row, now on real line boxes and with the two things it was
          missing. `InboxThreadList`'s wide row is ONE 24px line — a `size-6` avatar,
          the name at `text-lead`, a status pill, the time pushed right — over a
          `mt-0.5 text-body` preview. This drew neither the avatar nor the pill, spaced
          the preview with `space-y-2` where the real gap is `mt-0.5`, and reserved
          `h-4`/`h-3` for a 24px and a 22.4px line. That is ~18px short PER ROW, so a
          seven-thread inbox stood about 125px short and the whole list slid up on
          swap. */}
      <div className="hidden items-center gap-3 p-4 md:flex">
        <Skeleton className="size-12 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <TextLines className="min-w-0 flex-1 text-lead" widths={['w-1/3']} />
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            <TextLines className="ml-auto shrink-0 text-meta" widths={['w-12']} />
          </div>
          <TextLines className="mt-0.5 text-body" widths={['w-3/4']} />
        </div>
      </div>
    </>
  );
}

export function NotificationRowSkeleton() {
  return (
    // `border border-transparent` because the real row is a button that reserves
    // one for its focus ring; without it the placeholder is 2px short per row.
    <div className="flex items-start gap-3 border border-transparent px-4 py-3.5">
      <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <TextLines className="min-w-0 flex-1 text-body" widths={['w-2/5']} />
          <TextLines className="shrink-0 text-meta" widths={['w-12']} />
        </div>
        <TextLines className="mt-0.5 text-body" widths={['w-4/5']} />
      </div>
    </div>
  );
}

/**
 * Contract room. Below `md` that is a thread — bar, log, composer — because the
 * details are a sheet, not a pane; from `md` it is the identity card above the
 * details/chat split.
 */
export function ContractRoomSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-group md:px-4 md:pt-4 lg:h-[calc(100dvh-5rem-1px-env(safe-area-inset-top))] lg:flex-none">
      {/* REAL LINE BOXES on the desktop half too. The phone thread below already used
          `TextLines`; this card was still on fixed bars, so the one part of the room a
          desktop viewer sees first was the least accurate. `ContractHeader`'s title is
          `font-display text-subhead font-semibold` — a 23.8px line box against the 20px
          an `h-5` reserved — and the money figure beside it is `text-lead` (24px)
          against `h-5`. */}
      <Card className="hidden border-border shadow-sm md:block">
        <div className="flex flex-wrap items-center justify-between gap-x-group gap-y-snug px-group py-cozy">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-group gap-y-1">
            <TextLines className="text-subhead" widths={['w-40']} />
            <div className="flex items-center gap-2">
              <Skeleton className="size-6 rounded-full" />
              <TextLines className="text-body" widths={['w-24']} />
              <Skeleton className="size-6 rounded-full" />
              <TextLines className="text-body" widths={['w-20']} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-cozy">
            {/* The status badge stays a box — it IS one. The money figure is
                `display-value text-lead`, so it gets a line box. */}
            <Skeleton className="h-6 w-24 rounded-full" />
            <TextLines className="text-lead" widths={['w-20']} />
          </div>
        </div>
      </Card>

      {/* Phone: the thread — bar, log, action dock, composer, in that order.
          Mirrors `ContractChat`. */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {/* `bg-card` and `size-11` on the back control, both of which the real
            bar has: it is opaque, and the chevron is a touch target because it
            only exists at this width. A `size-10` here left the bar 4px short. */}
        <div className="flex shrink-0 items-center gap-cozy border-b bg-card px-cozy py-2.5">
          <Skeleton className="-ml-1.5 size-11 shrink-0 rounded-full" />
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <TextLines className="text-lead leading-tight" widths={['w-2/5']} />
            <TextLines className="text-body leading-tight" widths={['w-28']} />
          </div>
        </div>
        {/* The log is `flex-1`; its height is whatever the fixed bands leave, so
            the bubbles are texture rather than geometry. */}
        <div className="min-h-0 flex-1 space-y-3 p-cozy">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl" />
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
        {/* THE ACTION DOCK, which this skeleton used to omit entirely. Every
            contract room renders one — it is the room's single live control —
            so a ~56px tinted band appeared above the composer on swap and shoved
            the whole log up. `px-cozy py-snug` around a 40px control row is
            `ContractActionCard`'s own geometry. */}
        <div className="relative z-10 shrink-0 border-t bg-card">
          <div className="flex items-center gap-cozy px-cozy py-snug">
            <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
          </div>
        </div>
        {/* `pt-4` and nothing else: the compact composer resolves to
            `max-md:px-0 max-md:pb-0`, so the old `p-cozy` inset the two round
            buttons 12px from the edges they actually sit on. */}
        <div className="flex shrink-0 items-center gap-2 border-t pt-4">
          <Skeleton className="size-11 shrink-0 rounded-md" />
          <Skeleton className="h-11 min-w-0 flex-1 rounded-2xl" />
          <Skeleton className="size-11 shrink-0 rounded-md" />
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 gap-group md:block lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
        <div className="space-y-3">
          <Card className="p-5">
            <Skeleton className="mb-3 h-5 w-56" />
            <Skeleton className="mb-4 h-4 w-full max-w-md" />
            <Skeleton className="h-10 w-36 rounded-md" />
          </Card>
          <Card className="p-5">
            <Skeleton className="mb-3 h-4 w-24" />
            <Skeleton className="h-20 w-full" />
          </Card>
          <Card className="p-5">
            <Skeleton className="mb-3 h-4 w-28" />
            <Skeleton className="h-16 w-full" />
          </Card>
        </div>
        <Card className="mt-4 hidden min-h-[22rem] flex-col p-4 lg:mt-0 lg:flex">
          <div className="mb-4 flex items-center gap-3 border-b pb-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex-1 space-y-3">
            <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl" />
            <Skeleton className="h-12 w-2/3 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          </div>
          <Skeleton className="mt-4 h-11 w-full rounded-md" />
        </Card>
      </div>
    </div>
  );
}

export function ChatThreadSkeleton() {
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col"
      aria-label="Loading conversation"
    >
      {/* Matches ChatThread band for band: the bar (phone-only back, thumb,
          title + subline, contract button), the log, the standing note, the
          composer.

          THE IRIS DOCK IS GONE FROM BOTH. This used to draw a three-element
          tinted action strip above the composer, because that is where the
          thread's contract control lived. It moved up into the bar — the room's
          dock holds live actions on a contract and a thread has none, so all
          that was left down there was navigation. The stale copy was ~100px of
          tinted block that the real thread never renders: a jump AND a colour
          flash on every thread open. What remains at the bottom is the one-line
          "nothing is held while you are only talking" note. */}
      <header className="flex shrink-0 items-center gap-cozy border-b px-group py-2.5 max-md:px-cozy">
        <Skeleton className="-ml-1.5 size-11 shrink-0 rounded-full md:hidden" />
        <Skeleton className="size-9 shrink-0 rounded-md" />
        {/* `text-lead leading-tight` over `text-body leading-tight`, and NO `space-y`.
            `ChatThread`'s h2 and its meta line are adjacent blocks with no gap between
            them, so the `space-y-1.5` that was here invented 6px; the bars themselves
            were `h-4`/`h-3` against 20px and 17.5px line boxes. Note `leading-tight`
            overrides the type token's own line-height and must be carried here too, or
            the placeholder over-reserves instead. */}
        <div className="min-w-0 flex-1">
          <TextLines className="text-lead leading-tight" widths={['w-2/5']} />
          <TextLines className="text-body leading-tight" widths={['w-28']} />
        </div>
        {/* `h-8 md:h-7`, `Button`'s `sm` size — `ChatThread`'s header dock renders
            `size="sm"`. `sm` went 24px -> 28px at `md` alongside the default's
            28px -> 32px, so a flat `h-8` is right on touch and 4px proud on a
            pointer. */}
        <Skeleton className="h-8 w-24 shrink-0 rounded-md md:h-7" />
      </header>
      <div className="min-h-0 flex-1 space-y-3 px-group pt-5 max-md:px-cozy">
        <Skeleton className="h-12 w-3/5 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
        <Skeleton className="h-10 w-2/5 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" />
      </div>
      {/* NO STANDING NOTE. A bordered band used to sit here for the "nothing is
          held while you are only talking" line, drawn unconditionally. The real
          thread renders it only when the conversation is NOT under a contract,
          which every trade and sale thread is — so on those it was a ~41px band
          that vanished, and on a listing thread the copy wraps to two lines
          against the 16px that was reserved. `loading.tsx` cannot know which
          kind of thread it is about to show, so it reserves neither. */}
      {/* The composer: a 44px row under a rule, not a 48px slab. `border-t` and
          `pt-4 pb-0` are `MessageComposer`'s non-compact geometry. */}
      <div className="shrink-0 border-t px-group pt-4 max-md:px-cozy">
        <div className="flex items-center gap-2">
          <Skeleton className="size-11 shrink-0 rounded-md" />
          <Skeleton className="h-11 min-w-0 flex-1 rounded-2xl" />
          <Skeleton className="size-11 shrink-0 rounded-md" />
        </div>
      </div>
    </section>
  );
}
