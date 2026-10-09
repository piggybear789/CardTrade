// app/sellers/[id]/loading.tsx
//
// Public seller profile in MarketplaceShell. THREE STACKED BANDS, matching the live
// page: back link, header (identity + trust band), then a tab strip over one panel.
//
// REBUILT FOR THE TABBED LAYOUT. This file described the design the page had BEFORE
// `TabbedPanels`: two visible `text-subhead` headings — "Available listings" and
// "Reviews" — over a tile grid and a stack of review cards, one under the other. All of
// that is gone. The headings are `sr-only` now, the panels are held in `<Activity>` so
// only ONE is on screen at a time, and a strip sits above them. The placeholder was
// therefore drawing roughly 72px of headings that never appear and ~120px of reviews
// that cannot appear beside the grid, while reserving nothing at all for the strip or
// the trust band. Every profile visibly re-laid itself out on swap.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { CatalogTileGridSkeleton } from '@/components/layout/catalogSkeletons';
import { TabbedPanelsSkeleton } from '@/components/ui/tabbed-panels';

export default function SellerProfileLoading() {
  return (
    <MarketplaceShellSkeleton title="Seller">
      {/* No wrapper div: the live page hangs the nav, the header and the strip straight
          off `MarketplaceShell`.

          Spacing below is copied from it term for term — `mb-cozy` here, `mb-5 space-y-snug
          pb-group` on the header, and a 40px avatar (`Avatar size="md"`). */}
      <nav className="mb-cozy hidden md:block">
        <TextLines className="text-body" widths={['w-36']} />
      </nav>

      <header className="mb-5 space-y-snug border-b pb-group">
        {/* A column below `sm`, because the Report control stacks under the identity
            block there rather than sitting beside it. */}
        <div className="flex flex-col items-stretch gap-cozy sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-cozy">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            {/* `space-y-1.5`, the column's real rhythm. */}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-snug">
                {/* `text-subhead` below `md`, not the 32px an `h-8` reserved. The name
                    width is canonical texture; the `h-5 w-20` pill keeps its reserve. */}
                <TextLines className="text-subhead md:text-head" widths={['w-1/2']} />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              {/* StarRating, then the social links row. Both are conditional on the
                  seller having them, and both are the common case on a profile reached
                  through a listing.

                  The rating row is 16px stars beside a `text-meta` label inside the
                  link's 1px transparent border — 18.8px, not a 22.4px `text-body`
                  line. The page now lays that link out as a block (`flex w-fit`) so
                  it takes the column's `space-y-1.5` like every other row here. */}
              <div className="flex h-[1.175rem] items-center">
                {/* The row height is the reserve (`h-[1.175rem]`); the bar is texture. */}
                <Skeleton className="h-4 w-1/3" />
              </div>
              {/* The social links row: a fixed `min-h-6` on the page now, links or not.
                  The row's min-height is the reserve; the bar width is texture. */}
              <div className="flex min-h-6 items-center">
                <Skeleton className="h-4 w-1/3" />
              </div>
              {/* The bio: one line, the common case. The page shows it only when the
                  seller wrote one (or, for the owner, an "Add a bio" link). */}
              <TextLines className="max-w-prose text-body" widths={['w-2/3']} />
            </div>
          </div>
          {/* Message and the ⋯ menu (or Edit profile / Sign in to message — one control
              row for every viewer). `size="sm"`, full-width below `sm`. */}
          <Skeleton className="h-9 w-full shrink-0 rounded-md sm:w-24 md:h-8" />
        </div>

        {/* THE TRUST BAND: one row of facts in a bordered band — a 16px shield beside
            a line of body copy. It wraps to a second line on a phone for a verified
            seller with several facts; one line is the reserve. */}
        <section className="mt-cozy flex items-center gap-tight rounded-lg border bg-muted/60 px-group py-cozy">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <TextLines className="min-w-0 flex-1 text-body" widths={['w-3/4']} />
        </section>
      </header>

      {/* The strip, from its own shape constants. Two labels, not three: "Sold" is
          offered only when the seller has sold something, and a tab that is usually
          absent is not the width to reserve. */}
      <TabbedPanelsSkeleton labels={['Listings', 'Reviews']} />

      {/* The Listings panel, which is where a bare URL lands — so it is the only panel
          drawn. Its heading is `sr-only` on the live page and takes no space. */}
      <CatalogTileGridSkeleton count={6} />
    </MarketplaceShellSkeleton>
  );
}
