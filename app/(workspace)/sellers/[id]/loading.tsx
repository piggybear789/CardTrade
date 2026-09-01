// app/sellers/[id]/loading.tsx
//
// Public seller profile lives in MarketplaceShell: back link, avatar header,
// then the same compact catalog tiles as browse.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { CatalogTileGridSkeleton } from '@/components/layout/WorkspaceSkeletons';

export default function SellerProfileLoading() {
  return (
    <MarketplaceShellSkeleton title="Seller">
      <div className="min-w-0">
        {/* Spacing below is copied from the live page term for term — `mb-3`
            here, `mb-5 pb-4` on the header, `mb-8` on the listings section, and a
            40px avatar (`Avatar size="md"`). It previously ran 6/8/6/10 with a
            56px avatar, which stood the placeholder about 50px taller than the
            content and jumped everything below the fold upward on swap. */}
        <nav className="mb-3">
          <TextLines className="text-body" widths={['w-36']} />
        </nav>

        <header className="mb-5 space-y-2 border-b pb-4">
          {/* A column below `sm`, because the Report control stacks under the
              identity block there rather than sitting beside it. */}
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              {/* `space-y-1.5`, the column's real rhythm. */}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {/* `text-subhead` below `md`, not the 32px an `h-8` reserved. */}
                  <TextLines
                    className="text-subhead md:text-head"
                    widths={['w-44']}
                  />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <TextLines className="text-body" widths={['w-36']} />
                <TextLines className="text-body" widths={['w-full']} />
              </div>
            </div>
            {/* Report. `size="sm"` and full-width below `sm`, so 32px plus the
                12px column gap. It is drawn unconditionally even though the real
                trigger needs a signed-in viewer on someone else's profile:
                that is how this page is normally reached — through a listing —
                and the alternative is to under-reserve for the common case. */}
            <Skeleton className="h-8 w-full shrink-0 rounded-md sm:w-24" />
          </div>
        </header>

        <section className="mb-8">
          {/* `text-body` below `md`, `text-subhead` from there, and `mb-3` not
              `mb-4` — the heading sat 4px too far from its grid at phone width. */}
          <TextLines
            className="mb-3 text-body md:mb-4 md:text-subhead"
            widths={['w-40']}
          />
          <CatalogTileGridSkeleton count={6} />
        </section>

        <section>
          <TextLines
            className="mb-3 text-body md:mb-4 md:text-subhead"
            widths={['w-28']}
          />
          {/* Matches `SellerReviewsFallback` in the page, not `ReviewList`: the
              reviews stream inside their own Suspense boundary, so this hands off
              to that fallback rather than straight to the content. */}
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </section>
      </div>
    </MarketplaceShellSkeleton>
  );
}
