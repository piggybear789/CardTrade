'use client';

// components/deals/DealInviteSkeleton.tsx
//
// Loading state for `/t/[token]`, drawn in the SAME shell the page will resolve to.
//
// THE ROUTE HAS TWO SHELLS. A signed-out visitor gets a bare `PageShell` around
// `PublicDealInvitePreview`; a member gets `MarketplaceShell center` — desktop rail and
// all — around `DealJoinForm`. The loader used to draw the bare one for everybody, so on
// every member visit from `md` up the rail vanished for the loading moment and then the
// whole page slid sideways by the rail's width when it came back.
//
// SIGNED-IN IS READ FROM THE WORKSPACE CHROME CONTEXT, NOT FETCHED. The
// `(workspace)` layout is not replaced by a child's `loading.tsx`, so its provider is
// already mounted here, and it sets `staff` exactly when there is a profile — i.e. when
// the viewer is signed in. That is the same trick `MarketplaceShellSkeleton` uses to
// draw the live rail, and it keeps this a placeholder that queries nothing.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { PageShell } from '@/components/layout/PageShell';
import { useWorkspaceChrome } from '@/components/layout/WorkspaceChrome';
import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { CheckoutSummarySkeleton } from '@/components/payments/CheckoutSummarySkeleton';

export function DealInviteSkeleton() {
  const { staff } = useWorkspaceChrome();

  if (staff) {
    return (
      <MarketplaceShellSkeleton title="Private deal" center>
        <DealInviteCardSkeleton withCheckout />
      </MarketplaceShellSkeleton>
    );
  }

  // The guest branch's `PageShell` VERBATIM, bottom reserve included — see the note on
  // it in the page for why the reserve exists.
  return (
    <PageShell
      centered
      className="max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10"
    >
      <div role="status" aria-busy="true" aria-label="Loading private deal">
        <span className="sr-only">Loading…</span>
        <DealInviteCardSkeleton />
      </div>
    </PageShell>
  );
}

/**
 * The invite card both branches render: `Card` with a `CardHeader` (subhead title,
 * one line of description), a `CardContent` holding `DealInviteSummary` — the
 * "From …" line over `DealInviteFacts` — and a `CardFooter` with one button.
 *
 * It replaces a hand-drawn box with `rounded-xl`, `p-6` and two 64px slabs, none of
 * which the real `Card` (`rounded-lg`, `p-group`) or its definition list has. Each fact
 * is a `text-body` label over a `text-lead` value at `gap-tight`; the price is
 * `text-head`, and the card fact carries a `size-16` thumbnail beside its title.
 */
function DealInviteCardSkeleton({ withCheckout = false }: { withCheckout?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border border-border bg-card shadow-market">
      <div className="flex flex-col space-y-snug p-group">
        <TextLines className="text-subhead" widths={['w-32']} />
        {/* Every `CardDescription` branch runs ~60 characters: one line in the 480px
            card from `sm`, two in a phone's ~311px. One bar under-reserved the phone
            card by a line, and the shell is `center`, so it moved by half of that. */}
        <TextLines className="text-body" widths={['w-full sm:w-4/5', 'w-2/5 sm:hidden']} />
      </div>

      <div className="grid gap-group p-group pt-0">
        <TextLines className="text-body" widths={['w-28']} />
        <div className="grid gap-group">
          <div className="grid gap-tight">
            <TextLines className="text-body" widths={['w-12']} />
            <TextLines className="text-lead" widths={['w-36']} />
          </div>
          <div className="grid gap-tight">
            <TextLines className="text-body" widths={['w-12']} />
            <TextLines className="text-head" widths={['w-24']} />
          </div>
          <div className="grid gap-tight">
            <TextLines className="text-body" widths={['w-24']} />
            <div className="flex items-center gap-group">
              <Skeleton className="size-16 shrink-0" />
              <TextLines className="min-w-0 flex-1 text-lead" widths={['w-3/4']} />
            </div>
          </div>
        </div>
        {/* A member joining a sale link lands on `DealJoinForm`, whose content opens
            with the summary above and then the checkout block — the verified seller
            over the saved card — under `space-y-group`. That block is ~150px and the
            shell is `center`, so leaving it out moved the whole card up by half of it
            on swap. Reserved with the form's own placeholder for it, so the loader and
            the form's in-place loading state are one shape. A trade link shows a
            card-description row there instead, which this does not guess at. */}
        {withCheckout ? <CheckoutSummarySkeleton /> : null}
      </div>

      {/* `Button` default size: `h-9 md:h-8`. `w-full sm:w-auto` is the join form's. */}
      <div className="flex items-center p-group pt-0">
        <Skeleton className="h-9 w-full sm:w-32 md:h-8" />
      </div>
    </div>
  );
}
