// app/listings/[id]/loading.tsx
//
// Phone: the photo carousel, then title, meta line, price, fee note, protection line,
// the borderless seller row and the description.
// Desktop: back-nav row, gallery (rail + frame) on the left, `ListingDesktopPane` on the
// right: title, meta line, price, fee note, the action stack, protection line, seller
// row, description.
//
// TWO COLUMNS, NOT ONE, ON THE RIGHT. The page renders `ListingDetailStack` inside an
// `lg:hidden` wrapper and `ListingDesktopPane` (`hidden lg:flex`) beside it. This
// placeholder used to draw the PHONE stack at every size, so on desktop the seller row
// sat where the title resolves and the whole column re-laid out under the reader. Each
// half below mirrors the component it stands in for, under the same breakpoint gate.
//
// The status badge is not reserved: it renders only for a listing that is NOT
// available, and a buyer almost always lands on one that is.

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

        {/* Desktop-only back-nav row: the back button alone. It is `size="sm"`, which
            is `md:h-8`; any other height makes the row differ from the page's at every
            desktop width.

            The button is inset by the rail band (`ml-region`), which the page applies
            whenever there is more than one photo — see the gallery note below for why
            that is the case this reserves. */}
        <div className="mb-snug hidden flex-wrap items-center justify-between gap-snug lg:flex">
          <Skeleton className="ml-region h-8 w-40" />
        </div>

        <div className="flex min-h-0 flex-col items-stretch lg:flex-1 lg:flex-row lg:gap-6">
          {/* GALLERY: `GALLERY_SHELL` — a `w-14` thumbnail rail centred on the left, the
              frame filling what is left.

              The rail only renders for more than one photo, and this route cannot know
              the count. Card listings are overwhelmingly front-and-back at minimum, so
              reserving the rail is the side that is right more often; a single-photo
              listing gives up 64px of frame width on swap rather than every multi-photo
              listing gaining a rail out of nowhere and shoving the photo sideways. */}
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

/** The `ListingSellerRow`: a divider, then a 40px avatar beside two lines. */
function SellerRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex min-w-0 items-center gap-cozy border-t border-border pt-group">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-tight">
          <TextLines className="text-body" widths={['w-1/2']} />
          <TextLines className="text-meta" widths={['w-2/3']} />
        </div>
      </div>
    </div>
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

      {/* Meta line: the stack always reserves two lines for it (`line-clamp-2
          min-h-[2lh]`), so nothing below moves with the location. */}
      <TextLines className="mt-snug text-meta" widths={['w-2/3', 'w-1/3']} />

      {/* Price (`text-display`), then the one-line fee note at `mt-tight`. */}
      <TextLines className="mt-snug text-display" widths={['w-1/3']} />
      <TextLines className="mt-tight text-meta" widths={['w-1/2']} />

      {/* The protection line: one `text-meta` line at `mt-group`. */}
      <TextLines className="mt-group text-meta" widths={['w-full']} />

      <SellerRowSkeleton className="mt-group" />

      {/* `ExpandableDescription` is `text-body line-clamp-4`. The clamp ceiling is the
          right thing to reserve: `line-clamp-4` and the "Read more" control both switch
          on at 200 characters, which at this column width IS about four lines. */}
      <TextLines
        className="mt-group text-body"
        widths={['w-full', 'w-full', 'w-full', 'w-1/2']}
      />
      {/* The "Read more" control is `min-h-10` — a touch target, not a text row. */}
      <Skeleton className="mt-tight h-10 w-1/3" />
    </div>
  );
}

/** `ListingDesktopPane`. From `lg` only. */
function DesktopPaneSkeleton() {
  return (
    <div className="hidden flex-col gap-group lg:flex">
      {/* Header (`space-y-snug`): the `text-head` title with the Save / "⋯" pair
          (`size-9` each) on the right, the meta line, then the `text-display` price
          with the fee note at `mt-tight`. */}
      <div className="space-y-snug">
        <div className="flex items-start justify-between gap-cozy">
          <TextLines className="min-w-0 flex-1 text-head" widths={['w-2/3']} />
          <div className="-mr-snug -mt-tight flex shrink-0 items-center">
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
          </div>
        </div>
        <TextLines className="text-meta" widths={['w-1/2']} />
        <div>
          <TextLines className="text-display" widths={['w-1/3']} />
          <TextLines className="mt-tight text-meta" widths={['w-1/3']} />
        </div>
      </div>

      {/* The action stack: Buy now (`lg`, 40px from `md`), the Offer | Trade pair
          beneath it, then the full-width Message seller row. */}
      <div className="space-y-group">
        <div className="space-y-snug">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 gap-snug">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
      </div>

      {/* The protection line: one `text-meta` line. */}
      <TextLines className="text-meta" widths={['w-full']} />

      <SellerRowSkeleton />

      {/* Description: a `text-meta` eyebrow at `mb-tight`, then the body UNCLAMPED —
          the pane prints the whole text and the column scrolls. */}
      <div>
        <TextLines className="mb-tight text-meta" widths={['w-1/3']} />
        <TextLines
          className="text-body"
          widths={['w-full', 'w-full', 'w-full', 'w-1/2']}
        />
      </div>
    </div>
  );
}
