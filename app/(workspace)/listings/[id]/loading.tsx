// app/listings/[id]/loading.tsx
//
// Phone: seller row, price, meta, description, then the stacked photos.
// Desktop: back-nav row, cover pane on the left, the same column on the right.
//
// MIRRORS `ListingDetailStack`, WHICH IS BREAKPOINT-DEPENDENT. Several blocks in that
// component only exist at one size, and the previous placeholder drew all of them at
// every size — a title bar and a location bar that on a phone are `sr-only` and
// `lg:inline` respectively, so the skeleton was about 40px taller than the page it
// stood in for and everything below the price sat too low. It also missed the seller
// row's `min-h-11`, the column's `pt-3`, and used `mt-4` where the stack uses `mt-3`.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ItemDetailLoading() {
  return (
    <MarketplaceShellSkeleton title="Marketplace">
      <div
        // `pb-8` is the no-buyer-bar case. Whether the bar shows depends on viewer and
        // listing state this placeholder must not read, and bottom padding moves
        // nothing above it, so the common case is the safe one.
        className="flex min-h-0 flex-col pb-8 lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:pb-0"
        role="status"
        aria-busy="true"
        aria-label="Loading listing"
      >
        <span className="sr-only">Loading…</span>

        {/* Desktop-only back-nav and badge row. Absent before, so on desktop the
            whole column started ~40px above where it resolved to. */}
        <div className="mb-2 hidden flex-wrap items-center justify-between gap-2 lg:flex">
          <Skeleton className="h-8 w-36 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>

        <div className="flex min-h-0 flex-col items-stretch lg:flex-1 lg:flex-row lg:gap-6">
          <div className="hidden min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <Skeleton className="h-full min-h-[22rem] w-full rounded-lg" />
          </div>

          <div className="flex min-w-0 flex-col pt-3 lg:flex-1 lg:pt-0">
            {/* Seller row — `min-h-11` and `py-1` are the real link's, and they are
                what make this 44px rather than the 28px of the avatar inside it. */}
            <div className="flex min-h-11 items-center gap-2 py-1">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              {/* Location is `lg:inline` in the stack, so it must not draw on a phone. */}
              <Skeleton className="ml-auto hidden h-3 w-20 lg:block" />
            </div>

            <div className="mt-3 flex items-center gap-3 md:mt-4">
              {/* The price is `text-display` at `leading-none`, so 32px exactly. */}
              <Skeleton className="h-8 w-32" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>

            {/* Meta line. Bars sit in a real `text-meta` line box so the height comes
                from the type scale rather than a guess. */}
            <div className="mt-2 text-meta">
              <Skeleton className="inline-block h-[0.9em] w-2/3 align-middle" />
            </div>

            {/* The title only renders from `md` up — on a phone the stack's `h2` is
                `sr-only`, and the visible title lives in the description. */}
            <div className="mt-4 hidden text-subhead md:block">
              <Skeleton className="inline-block h-[0.9em] w-4/5 align-middle" />
            </div>

            <div className="mt-3 space-y-2 md:mt-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>

            {/* The stacked photos. Aspect rather than a fixed height: these render at
                the photo's own ratio, and a card is portrait — `h-48` reserved 192px
                for something that is usually more than twice that. */}
            <Skeleton className="mt-4 aspect-[4/5] w-full rounded-lg lg:hidden" />
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
