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

/** One fact in `SellerTrustBand` — a `text-meta` label over a `text-body` value. */
function FactSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div className="min-w-0">
      <TextLines className="text-meta" widths={[labelWidth]} />
      <TextLines className="text-body" widths={['w-3/4']} />
    </div>
  );
}

// `SellerTrustBand`'s own `FACT_GRID`: two columns on a phone so five facts are three
// rows, three from `sm` with the vertical gap dropped.
const FACT_GRID = 'grid grid-cols-2 gap-x-group gap-y-cozy sm:grid-cols-3 sm:gap-y-0';

export default function SellerProfileLoading() {
  return (
    <MarketplaceShellSkeleton title="Seller">
      {/* No wrapper div: the live page hangs the nav, the header and the strip straight
          off `MarketplaceShell`.

          Spacing below is copied from it term for term — `mb-cozy` here, `mb-5 space-y-snug
          pb-group` on the header, and a 40px avatar (`Avatar size="md"`). */}
      <nav className="mb-cozy">
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
                {/* `text-subhead` below `md`, not the 32px an `h-8` reserved. */}
                <TextLines className="text-subhead md:text-head" widths={['w-44']} />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              {/* StarRating, then the social links row. Both are conditional on the
                  seller having them, and both are the common case on a profile reached
                  through a listing. */}
              <TextLines className="text-body" widths={['w-36']} />
              <TextLines className="text-body" widths={['w-24']} />
            </div>
          </div>
          {/* Report. `size="sm"` — h-8 on touch, h-7 from `md` — and full-width below
              `sm`, so it also carries the 12px column gap. Drawn unconditionally even
              though the real trigger needs a signed-in viewer on someone else's
              profile: that is how this page is normally reached, and the alternative is
              to under-reserve for the common case. */}
          <Skeleton className="h-8 w-full shrink-0 rounded-md sm:w-24 md:h-7" />
        </div>

        {/* THE TRUST BAND, which this file reserved nothing for. It is inside the
            header, above the strip, and on a verified seller it is the tallest single
            object on the page above the fold — an icon heading plus a row of facts,
            which is what pushed the grid down when it arrived.

            The verified group only; the record group beneath it is a second `p-group`
            block behind a `border-t` and appears on a narrower set of profiles, so
            reserving both would over-shoot the common case in the other direction. */}
        <section className="mt-cozy rounded-lg border bg-muted/60">
          <div className="p-group">
            {/* `mb-cozy flex items-center gap-tight text-body font-medium` — a 16px
                glyph beside one line of body copy. */}
            <div className="mb-cozy flex items-center gap-tight">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <TextLines className="min-w-0 text-body" widths={['w-56']} />
            </div>
            <div className={FACT_GRID}>
              <FactSkeleton labelWidth="w-24" />
              <FactSkeleton labelWidth="w-12" />
              <FactSkeleton labelWidth="w-20" />
            </div>
          </div>
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
