'use client';

// components/deals/DealInviteSkeleton.tsx
//
// Loading state for `/t/[token]`, drawn in the SAME shell the page will resolve to.
//
// THE ROUTE HAS TWO SHELLS. A signed-out visitor gets a bare `PageShell` around
// `PublicDealInvitePreview`; a member gets `MarketplaceShell` — desktop rail and
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

export function DealInviteSkeleton() {
  const { staff } = useWorkspaceChrome();

  if (staff) {
    return (
      <MarketplaceShellSkeleton title="Private deal">
        <DealInviteCardSkeleton withFooterNote />
      </MarketplaceShellSkeleton>
    );
  }

  // Both branches are TOP-ALIGNED, as the page is — see the note there.
  // The guest branch's `PageShell` VERBATIM, bottom reserve included — see the note on
  // it in the page for why the reserve exists.
  return (
    <PageShell
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
function DealInviteCardSkeleton({ withFooterNote = false }: { withFooterNote?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border border-border bg-card shadow-market">
      <div className="flex flex-col space-y-snug p-group">
        <TextLines className="text-subhead" widths={['w-32']} />
        {/* Every `CardDescription` branch is ~35 characters, one line at every width. */}
        <TextLines className="text-body" widths={['w-56 max-w-full']} />
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
      </div>

      {/* The join form's footer: the "Nothing is paid or held" note and the Join
          button, stacked on a phone and side by side from `sm`. A guest's preview has
          the same button row. `Button` default size: `h-9 md:h-8`. */}
      <div className="flex flex-col items-stretch gap-snug p-group pt-0 sm:flex-row sm:items-center sm:justify-between">
        {withFooterNote ? (
          // Two lines, as the join form's footer note now always reserves.
          <TextLines className="text-meta" widths={['w-56 max-w-full', 'w-24']} />
        ) : null}
        <Skeleton className="h-9 w-full sm:w-32 md:h-8" />
      </div>
    </div>
  );
}
