// app/admin/loading.tsx
//
// Operations console chrome: section header with the Cases hand-off, the five queue
// tabs, then the body of whichever queue `?tab=` names.
//
// USES THE SHARED HEADER AND FILTER SKELETONS rather than redrawing them. The
// hand-drawn versions applied the header's DESKTOP spacing at every width — `mb-5`,
// `pb-5`, `gap-cozy` where `SectionHeader` uses `mb-snug`, `pb-snug`, `gap-tight` below
// `md` — so the console header was roughly 24px too tall on a phone, and it drew a
// description line that the real header hides below `md`.
//
// THE BODY FOLLOWS `?tab=`. This used to draw the Payouts queue for every URL, so the
// Reports, Feedback, Errors and Reconciliation tabs each opened behind a ~400px custody
// panel that then vanished. `ConsoleTabSkeletonSwitch` reads the committed URL through
// the page's own `resolveConsoleTab` and picks one of the bodies below.

import type { ReactNode } from 'react';

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
import { ConsoleTabSkeletonSwitch } from '@/components/admin/ConsoleTabSkeletonSwitch';

/**
 * The custody panel that leads the Payouts tab: `mb-section rounded-lg border p-group`
 * around a wrapping heading row and three `<dl>` cells that stack below `sm`. One panel,
 * because a single-region deployment is the common case and a second would be a worse
 * guess than a missing one.
 */
function CustodyPanelSkeleton() {
  return (
    // `bg-muted` like the real panel, which made every `bg-muted/70` bar inside it
    // invisible: the panel loaded as an empty grey slab. The bars step up to the
    // border tone here so the placeholder reads as content arriving.
    <section className="mb-section rounded-lg border border-border bg-muted p-group [&_.animate-skeleton]:bg-border/70">
      {/* `size-4` icon and the two `h-6` badges keep their reserves; the heading bar is
          texture and draws canonical. */}
      <div className="mb-cozy flex flex-wrap items-center gap-snug">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <TextLines className="text-lead" widths={['w-1/2']} />
        <Skeleton className="h-6 w-28 shrink-0 rounded-md" />
        <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
      </div>
      {/* Each cell: label over figure over a two-line value. Line count is the
          reservation; widths are canonical texture. */}
      <div className="grid gap-cozy sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index}>
            <TextLines className="text-meta" widths={['w-1/3']} />
            <TextLines className="mt-0.5 text-subhead" widths={['w-1/3']} />
            <TextLines className="mt-0.5 text-body" widths={['w-full', 'w-1/2']} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The queue's heading row (`mb-group`, a `text-subhead` h3 plus its count badge) and the
 * standing explanation under it. `trailing` is what sits at the right of the row on the
 * two tabs that have something there: the drain button on Payouts, the filter links on
 * Errors.
 */
function QueueIntroSkeleton({
  headingWidth,
  trailing,
  lines,
  desktopLines,
}: {
  headingWidth: string;
  trailing?: ReactNode;
  /** Widths of the explanation's lines AT PHONE WIDTH, where it wraps the most. */
  lines: readonly string[];
  /**
   * How many of those lines remain from `md`, where the column is ~1000px wide and
   * the explanation wraps far less. The rest are `md:hidden`, which collapses their
   * line boxes (the block holds nothing else). Measured: a three-line reserve for the
   * one-line Reports explanation stood the queue 44px low on desktop.
   */
  desktopLines: number;
}) {
  // The LINE COUNT and the `md:hidden` gate are load-bearing (they reserve how many
  // lines the explanation wraps to at each width); the taper fraction on the last
  // desktop line is texture and draws from the canonical set.
  const widths = lines.map((width, index) =>
    index >= desktopLines ? `${width} md:hidden` : index === desktopLines - 1 ? `${width} md:w-1/2` : width,
  );
  return (
    <>
      <div className="mb-group flex flex-wrap items-center justify-between gap-cozy">
        <div className="flex min-w-0 flex-wrap items-center gap-snug">
          <TextLines className="text-subhead" widths={[headingWidth]} />
          <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
        </div>
        {trailing}
      </div>
      <TextLines className="mb-group text-body" widths={widths} />
    </>
  );
}

/**
 * PLAIN CARDS, NOT ARTICULATED ROWS. Every queue renders a `<Card>` per row in a
 * `space-y-group` list that opens with a wrapping badge row and a `CardDescription`;
 * below that this reserves one block and guesses nothing about which controls follow.
 */
function QueueCardsSkeleton() {
  return (
    <div className="space-y-group">
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-snug">
              <div className="flex min-w-0 flex-wrap items-center gap-snug">
                {/* The `h-6` badge keeps its reserve; the title/meta runs are texture. */}
                <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
                <TextLines className="text-lead" widths={['w-1/2']} />
              </div>
              <TextLines className="shrink-0 text-meta" widths={['w-1/3']} />
            </div>
            <TextLines className="text-body" widths={['w-full', 'w-1/2']} />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminLoading() {
  return (
    <MarketplaceShellSkeleton title="Operations">
      <SectionHeaderSkeleton hasActions titleClassName="w-44" descriptionClassName="w-96" />

      {/* "Reconciliation" shortens to "Reconcile" below `md`, so the desktop label is
          the width reserved — the strip scrolls on a phone, where an over-wide tab costs
          scroll extent rather than layout. */}
      <SectionFilterSkeleton
        labels={['Payouts', 'Reports', 'Feedback', 'Errors', 'Reconciliation']}
      />

      <ConsoleTabSkeletonSwitch
        panels={{
          payouts: (
            <>
              <CustodyPanelSkeleton />
              <QueueIntroSkeleton
                headingWidth="w-1/2"
                // `DrainPayoutsButton` is `size="sm"`.
                trailing={<Skeleton className="h-8 w-36 shrink-0 rounded-md md:h-7" />}
                lines={['w-full', 'w-full', 'w-full', 'w-1/2']}
                desktopLines={2}
              />
              <QueueCardsSkeleton />
            </>
          ),
          reports: (
            <>
              <QueueIntroSkeleton
                headingWidth="w-1/2"
                lines={['w-full', 'w-full', 'w-1/2']}
                desktopLines={1}
              />
              <QueueCardsSkeleton />
            </>
          ),
          feedback: (
            <>
              <QueueIntroSkeleton
                headingWidth="w-1/2"
                lines={['w-full', 'w-full', 'w-full', 'w-1/2']}
                desktopLines={2}
              />
              <QueueCardsSkeleton />
            </>
          ),
          errors: (
            <>
              <QueueIntroSkeleton
                headingWidth="w-1/3"
                // The Open / All / Show refusals filter links: `size="sm"`, so `h-8 md:h-7`.
                trailing={
                  // Own row on a phone, as `ErrorsQueue` now always lays it out.
                  <div className="flex w-full flex-wrap gap-tight md:w-auto">
                    <Skeleton className="h-8 w-14 rounded-md md:h-7" />
                    <Skeleton className="h-8 w-10 rounded-md md:h-7" />
                    <Skeleton className="h-8 w-28 rounded-md md:h-7" />
                  </div>
                }
                lines={['w-full', 'w-full', 'w-full', 'w-full', 'w-1/3']}
                desktopLines={3}
              />
              <QueueCardsSkeleton />
            </>
          ),
          reconciliation: (
            <>
              <QueueIntroSkeleton
                headingWidth="w-1/2"
                lines={['w-full', 'w-full', 'w-full', 'w-1/3']}
                desktopLines={2}
              />
              <QueueCardsSkeleton />
            </>
          ),
        }}
      />
    </MarketplaceShellSkeleton>
  );
}
