// app/listings/[id]/loading.tsx
//
// Phone: seller row and its two sub-lines, price, meta, description, the stacked
// photos, then `Based near`.
// Desktop: back-nav row, cover pane on the left, the same column on the right.
//
// MIRRORS `ListingDetailStack`, WHICH IS BREAKPOINT-DEPENDENT. Several blocks in that
// component only exist at one size, and the previous placeholder drew all of them at
// every size — a title bar and a location bar that on a phone are `sr-only` and
// `lg:inline` respectively, so the skeleton was about 40px taller than the page it
// stood in for and everything below the price sat too low. It also missed the seller
// row's `min-h-11`, the column's `pt-cozy`, and used `mt-group` where the stack uses `mt-cozy`.

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

        {/* Desktop-only back-nav and badge row. Absent before, so on desktop the
            whole column started ~40px above where it resolved to. */}
        <div className="mb-snug hidden flex-wrap items-center justify-between gap-snug lg:flex">
          <Skeleton className="h-8 w-36 rounded-md" />
          <div className="flex items-center gap-snug">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>

        <div className="flex min-h-0 flex-col items-stretch lg:flex-1 lg:flex-row lg:gap-6">
          <div className="hidden min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <Skeleton className="h-full min-h-[22rem] w-full rounded-lg" />
          </div>

          <div className="flex min-w-0 flex-col pt-cozy lg:flex-1 lg:pt-0">
            {/* Seller row — `min-h-11` and `py-tight` are the real link's, and they are
                what make this 44px rather than the 28px of the avatar inside it. */}
            <div className="flex min-h-11 items-center gap-snug py-tight">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              {/* Location is `lg:inline` in the stack, so it must not draw on a phone. */}
              <Skeleton className="ml-auto hidden h-3 w-20 lg:block" />
            </div>

            {/* THE TWO SELLER SUB-LINES, which this placeholder used to skip. The
                stack draws a real/stated-name line under the seller whenever that
                seller has an identity disclosure, and a rating link whenever they
                have a rating — ~43px together, so the price and everything below it
                started that far up and dropped on swap.

                Both are conditional in the stack and this route cannot know which
                way they will fall. A listing being read by a buyer normally carries
                both, so reserving them is the side that is right more often. */}
            <TextLines className="mt-tight text-meta" widths={['w-3/5']} />
            {/* `border border-transparent` is the rating link's own focus reserve —
                without it the row is 2px short. */}
            <div className="mt-tight w-fit border border-transparent">
              <TextLines className="text-meta" widths={['w-24']} />
            </div>

            <div className="mt-cozy flex items-center gap-cozy md:mt-group">
              {/* `h-7` (28px): `text-display` is `1.75rem` and `leading-none` pins the
                  line box to exactly that. The `h-8` that was here came with a comment
                  asserting 32px, which no token in the scale produces. */}
              <Skeleton className="h-7 w-32" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>

            {/* Meta line. Bars sit in a real `text-meta` line box so the height comes
                from the type scale rather than a guess. */}
            <TextLines className="mt-snug text-meta" widths={['w-2/3']} />

            {/* The title only renders from `md` up — on a phone the stack's `h2` is
                `sr-only`, and the visible title lives in the description. */}
            <TextLines className="mt-group hidden text-subhead md:block" widths={['w-4/5']} />

            {/* `ExpandableDescription` is `text-body line-clamp-4`, so
                four 21.125px lines, not the three `h-4` bars (76px) that were here.
                The clamp ceiling is the right thing to reserve: `line-clamp-4` and the
                "Read more" control both switch on at 200 characters, which at this
                column width IS about four lines, so a description long enough to fill
                the block is the same one that grows the control. */}
            <TextLines
              className="mt-cozy text-body md:mt-snug"
              widths={['w-full', 'w-full', 'w-full', 'w-4/5']}
            />
            {/* The "Read more" control is `min-h-10` — a touch target, not a text row. */}
            <Skeleton className="mt-tight h-10 w-24" />

            {/* The stacked photos. ONE NEUTRAL BLOCK, deliberately: the real gallery is
                a column of frames at each photo's own ratio, and this route knows
                neither the count nor the crop. A square is the least-wrong single
                guess across portrait singles, graded slabs and sealed product — the
                same call `CatalogTileSkeleton` makes — and committing to more frames
                would over-reserve a one-photo listing by more than the square costs a
                multi-photo one. The previous `aspect-[4/5]` guessed the crop with a
                confidence nothing here supports. */}
            <Skeleton className="mt-group aspect-square w-full rounded-lg lg:hidden" />

            {/* `Based near` — `PlaceMap presentation="inline"`, which is a pin beside
                one `text-body` line. Never reserved before, and it is on every listing:
                `ItemForm` refuses to submit without a location. `lg:hidden` because
                above `lg` this section belongs to `ListingDesktopPane` instead. */}
            <div className="mt-group flex items-center gap-cozy lg:hidden">
              <Skeleton className="size-4 shrink-0" />
              <TextLines className="min-w-0 flex-1 text-body" widths={['w-2/3']} />
            </div>
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
