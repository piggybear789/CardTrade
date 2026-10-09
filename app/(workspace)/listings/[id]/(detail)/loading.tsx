// app/listings/[id]/loading.tsx
//
// Phone: the photo carousel, then title, price, meta, the seller card and the
// description.
// Desktop: back-nav row, gallery (rail + frame) on the left, `ListingDesktopPane` on the
// right.
//
// TWO COLUMNS, NOT ONE, ON THE RIGHT. The page renders `ListingDetailStack` inside an
// `lg:hidden` wrapper and `ListingDesktopPane` (`hidden lg:flex`) beside it, and the two
// share almost nothing: the pane leads with a `text-head` title and the price, puts the
// seller in a card, prints the description unclamped and pins the action stack to the
// column's bottom edge. This placeholder used to draw the PHONE stack at every size, so
// on desktop the seller row sat where the title resolves, the price dropped by ~70px on
// swap and the whole column re-laid out under the reader. Each half below mirrors the
// component it stands in for, under the same breakpoint gate.
//
// MIRRORS `ListingDetailStack` block for block, including the title's step from
// `text-subhead` to `text-head` at `md`; the column's `pt-cozy` and each block's
// margin are the real component's.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export default function ItemDetailLoading() {
  return (
    <MarketplaceShellSkeleton title="Marketplace">
      <div
        // `pb-section` is the no-buyer-bar case. Whether the bar shows depends on viewer and
        // listing state this placeholder must not read, and bottom padding moves
        // nothing above it, so the common case is the safe one.
        className="flex min-h-0 flex-col pb-section lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:pb-0"
        role="status"
        aria-busy="true"
        aria-label="Loading listing"
      >
        <span className="sr-only">Loading…</span>

        {/* Desktop-only back-nav and badge row. The back button is `size="sm"`, which is
            `md:h-8`; any other height makes the row differ from the page's at every
            desktop width. Badges are `py-0.5` around a `text-meta` line plus a 1px
            border (≈22.8px) and `rounded-md`, not 20px pills.

            The button is inset by the rail band (`ml-region`), which the page applies
            whenever there is more than one photo — see the gallery note below for why
            that is the case this reserves. */}
        <div className="mb-snug hidden flex-wrap items-center justify-between gap-snug lg:flex">
          <Skeleton className="ml-region h-8 w-40" />
          <div className="flex items-center gap-snug">
            <Skeleton className="h-[1.425rem] w-[4.5rem]" />
            <Skeleton className="h-[1.425rem] w-20" />
            <Skeleton className="h-[1.425rem] w-24" />
          </div>
        </div>

        <div className="flex min-h-0 flex-col items-stretch lg:flex-1 lg:flex-row lg:gap-6">
          {/* GALLERY: `GALLERY_SHELL` — a `w-14` thumbnail rail centred on the left, the
              frame filling what is left.

              The rail only renders for more than one photo, and this route cannot know
              the count. Card listings are overwhelmingly front-and-back at minimum, so
              reserving the rail is the side that is right more often; a single-photo
              listing gives up 64px of frame width on swap rather than every multi-photo
              listing gaining a rail out of nowhere and shoving the photo sideways. The
              previous placeholder also centred a fixed-height block (`justify-center`)
              where the real frame fills the column top to bottom. */}
          <div className="hidden min-w-0 lg:flex lg:flex-1 lg:flex-col">
            <div className="flex min-h-0 flex-1 flex-row gap-snug">
              <div className="flex w-14 shrink-0 flex-col gap-snug self-center">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="size-14 rounded-md" />
                ))}
              </div>
              <Skeleton className="min-h-[22rem] min-w-0 flex-1 rounded-lg" />
            </div>
          </div>

          <div className="flex min-w-0 flex-col pt-cozy lg:flex-1 lg:overflow-hidden lg:pt-0">
            <PhoneStackSkeleton />
            <DesktopPaneSkeleton />
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}

/** `ListingDetailStack`, photo carousel first. Below `lg` only. */
function PhoneStackSkeleton() {
  return (
    <div className="flex flex-col lg:hidden">
      {/* THE CAROUSEL, AT ITS OWN ASPECT. Every slide of `SwipeCarousel` is
          `aspect-[4/5]` whatever the photo's shape — that fixed frame is what stops the
          page moving as you swipe — so this is not a guess about the crop. A listing
          without a photo resolves shorter, which moves nothing above it. */}
      <Skeleton className="aspect-[4/5] w-full rounded-lg" />

      {/* Title: `text-subhead md:text-head`. Two lines is the common case for a
          card title ("PSA 10 … 13/75"); the widths are texture. */}
      <TextLines
        className="mt-group text-subhead md:text-head"
        widths={['w-full', 'w-1/2']}
      />

      <div className="mt-snug flex items-center gap-cozy">
        {/* The price line is `text-display` (28px on a 1.1 line) — its height is the
            type scale, so the bar width is texture and draws canonical. The condition
            pill beside it keeps its honest `h-5 w-16` reserve. */}
        <TextLines className="text-display" widths={['w-1/3']} />
        <Skeleton className="ml-auto h-5 w-16 rounded-full" />
      </div>

      {/* Meta line: the stack always reserves two lines for it (`line-clamp-2
          min-h-[2lh]`), so nothing below moves with the location. */}
      <TextLines className="mt-snug text-meta" widths={['w-2/3', 'w-1/3']} />

      {/* The seller card: `p-cozy` around a 40px avatar beside three lines — the name
          (`text-body`), the rating and the verified name (`text-meta`), `gap-tight`
          apart. Every line always renders, so this is the card's real height. */}
      <div className="mt-group flex items-center gap-cozy rounded-lg border border-border bg-card p-cozy">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-tight">
          <TextLines className="text-body" widths={['w-1/3']} />
          <TextLines className="text-meta" widths={['w-1/3']} />
          <TextLines className="text-meta" widths={['w-2/3']} />
        </div>
      </div>

      {/* `ExpandableDescription` is `text-body line-clamp-4`. The clamp ceiling is the
          right thing to reserve: `line-clamp-4` and the "Read more" control both switch
          on at 200 characters, which at this column width IS about four lines. The
          final-line taper is texture. */}
      <TextLines
        className="mt-group text-body"
        widths={['w-full', 'w-full', 'w-full', 'w-1/2']}
      />
      {/* The "Read more" control is `min-h-10` — a touch target, not a text row. The
          height is the reserve; the width is texture. */}
      <Skeleton className="mt-tight h-10 w-1/3" />
    </div>
  );
}

/** `ListingDesktopPane`. From `lg` only. */
function DesktopPaneSkeleton() {
  return (
    <div className="hidden h-full flex-col gap-group lg:flex">
      {/* Header: `text-head` title, the `text-display` price line at `mt-tight`, the
          meta line at `mt-1.5`, and the Save / Report icon pair (`md:size-8` each)
          centred on the right. The icons are signed-in-non-owner only; a buyer is the
          reader this page is mostly for, and their width moves nothing vertically. */}
      {/* Title/price/meta are texture inside this `flex-1` column; their type-scale
          classes reserve the heights, so the widths draw from the canonical set. The
          `size-8` icon pair keeps its own reserve. */}
      <div className="flex items-center justify-between gap-cozy">
        <div className="min-w-0 flex-1">
          <TextLines className="text-head" widths={['w-2/3']} />
          <TextLines className="mt-tight text-display" widths={['w-1/3']} />
          <TextLines className="mt-1.5 text-meta" widths={['w-1/2']} />
        </div>
        <div className="flex shrink-0 items-center">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </div>

      {/* Seller card: `Card p-group`, a `size-10` avatar beside a `space-y-tight` column
          of name (`text-lead`), rating (`text-meta`) and the disclosed name
          (`text-meta leading-snug`). The column is taller than the avatar, so it — not
          the avatar — sets the card's height. */}
      <div className="rounded-lg border border-border bg-card p-group shadow-market">
        <div className="flex min-w-0 items-center gap-cozy">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-tight">
            <TextLines className="text-lead" widths={['w-1/3']} />
            <TextLines className="text-meta" widths={['w-1/3']} />
            <TextLines className="text-meta leading-snug" widths={['w-1/2']} />
          </div>
        </div>
      </div>

      {/* Description: a `text-meta` eyebrow at `mb-tight`, then the body UNCLAMPED —
          the pane prints the whole text and the column scrolls. Four lines is the same
          reservation the phone stack makes. */}
      <div>
        <TextLines className="mb-tight text-meta" widths={['w-1/3']} />
        {/* Four lines mirrors the phone stack's reservation; the final-line taper is
            texture and draws from the canonical set. */}
        <TextLines
          className="text-body"
          widths={['w-full', 'w-full', 'w-full', 'w-1/2']}
        />
      </div>

      {/* Action stack, pinned to the bottom with `mt-auto pt-group` exactly as the pane
          pins it, so it lines up with the frame's bottom edge. Buy / Trade / Offer are
          `ListingActionIcon`s — a `size-12` chip over a `text-body leading-tight` label
          — and the inline message composer is a bordered `p-cozy` card holding a label
          line and a field. Because it is bottom-pinned, a viewer who resolves to a
          different stack (owner controls, sign-in notice) changes nothing above it. */}
      <div className="mt-auto space-y-group pt-group">
        <div className="flex items-start gap-snug">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-tight">
              {/* The `size-12` chip is geometry (its own reserved box); the label under
                  it is texture in the centred `flex-1` column and draws canonical. */}
              <Skeleton className="size-12 rounded-full" />
              <TextLines className="text-body leading-tight" widths={['w-1/2']} />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-cozy">
          {/* The label is texture; the field (`min-h-10`) keeps its reserve. */}
          <TextLines className="mb-snug text-body" widths={['w-1/2']} />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
