// app/listings/[id]/loading.tsx
//
// Phone: seller row and its two sub-lines, price, meta, description, then the photo
// carousel.
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
// MIRRORS `ListingDetailStack`, WHICH IS ITSELF BREAKPOINT-DEPENDENT. Several blocks in
// that component only exist at one size — the title is `sr-only` on a phone, the meta
// line differs at `md` — so each bar below carries the visibility of the element it
// stands for. The seller row's `min-h-11`, the column's `pt-cozy` and the stack's
// `mt-cozy` are all the real component's.

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
            `md:h-7` — the `h-8` here made the row 4px taller than the page's at every
            desktop width. Badges are `py-0.5` around a `text-meta` line plus a 1px
            border (≈22.8px) and `rounded-md`, not 20px pills.

            The button is inset by the rail band (`ml-region`), which the page applies
            whenever there is more than one photo — see the gallery note below for why
            that is the case this reserves. */}
        <div className="mb-snug hidden flex-wrap items-center justify-between gap-snug lg:flex">
          <Skeleton className="ml-region h-7 w-40" />
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

/** `ListingDetailStack` and the photo carousel under it. Below `lg` only. */
function PhoneStackSkeleton() {
  return (
    <div className="flex flex-col lg:hidden">
      {/* Seller row — `min-h-11` and `py-tight` are the real link's, and they are what
          make this 44px rather than the 28px of the avatar inside it. */}
      <div className="flex min-h-11 items-center gap-snug py-tight">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>

      {/* THE TWO SELLER SUB-LINES. The stack draws a real/stated-name line under the
          seller whenever that seller has an identity disclosure, and a rating link
          whenever they have a rating — ~43px together. Both are conditional and this
          route cannot know which way they will fall; a listing being read by a buyer
          normally carries both, so reserving them is the side that is right more often. */}
      <TextLines className="mt-tight text-meta" widths={['w-3/5']} />
      {/* `border border-transparent` is the rating link's own focus reserve — without
          it the row is 2px short. */}
      <div className="mt-tight w-fit border border-transparent">
        <TextLines className="text-meta" widths={['w-24']} />
      </div>

      <div className="mt-cozy flex items-center gap-cozy md:mt-group">
        {/* The price line is `text-display` (28px on a 1.1 line), and the condition pill
            beside it is `py-0.5` around a `text-meta` line. */}
        <TextLines className="text-display" widths={['w-32']} />
        <Skeleton className="ml-auto h-5 w-16 rounded-full" />
      </div>

      {/* Meta line. Bars sit in a real `text-meta` line box so the height comes from the
          type scale rather than a guess. */}
      {/* Two lines below `md`: the stack now always reserves two for this line
          (`line-clamp-2 min-h-[2lh]`), so the title cannot move with the location. */}
      <TextLines className="mt-snug text-meta" widths={['w-2/3', 'w-1/3 md:hidden']} />

      {/* The title only renders from `md` up — on a phone the stack's `h2` is `sr-only`,
          and the visible title lives in the description. */}
      <TextLines className="mt-group hidden text-subhead md:block" widths={['w-4/5']} />

      {/* `ExpandableDescription` is `text-body line-clamp-4`. The clamp ceiling is the
          right thing to reserve: `line-clamp-4` and the "Read more" control both switch
          on at 200 characters, which at this column width IS about four lines. */}
      <TextLines
        className="mt-cozy text-body md:mt-snug"
        widths={['w-full', 'w-full', 'w-full', 'w-4/5']}
      />
      {/* The "Read more" control is `min-h-10` — a touch target, not a text row. */}
      <Skeleton className="mt-tight h-10 w-24" />

      {/* THE CAROUSEL, AT ITS OWN ASPECT. Every slide of `SwipeCarousel` is
          `aspect-[4/5]` whatever the photo's shape — that fixed frame is what stops the
          page moving as you swipe — so this is not a guess about the crop and should
          not be the `aspect-square` it was, which ran 25% short of the frame it stood
          for and lifted everything below it. `mt-group` is the page's wrapper.

          The `Based near` row that used to follow is gone: the page dropped the inline
          map for a clause of the meta line, and the placeholder kept drawing it. */}
      <Skeleton className="mt-group aspect-[4/5] w-full rounded-lg" />
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
      <div className="flex items-center justify-between gap-cozy">
        <div className="min-w-0 flex-1">
          <TextLines className="text-head" widths={['w-4/5']} />
          <TextLines className="mt-tight text-display" widths={['w-36']} />
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
            <TextLines className="text-lead" widths={['w-32']} />
            <TextLines className="text-meta" widths={['w-24']} />
            <TextLines className="text-meta leading-snug" widths={['w-1/2']} />
          </div>
        </div>
      </div>

      {/* Description: a `text-meta` eyebrow at `mb-tight`, then the body UNCLAMPED —
          the pane prints the whole text and the column scrolls. Four lines is the same
          reservation the phone stack makes. */}
      <div>
        <TextLines className="mb-tight text-meta" widths={['w-20']} />
        <TextLines
          className="text-body"
          widths={['w-full', 'w-full', 'w-full', 'w-3/5']}
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
              <Skeleton className="size-12 rounded-full" />
              <TextLines className="text-body leading-tight" widths={['w-16']} />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-cozy">
          <TextLines className="mb-snug text-body" widths={['w-40']} />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    </div>
  );
}
