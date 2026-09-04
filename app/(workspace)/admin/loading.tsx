// app/admin/loading.tsx
//
// Operations console chrome: section header with the Cases hand-off, the three queue
// tabs, then the Payouts queue — the tab `?tab=` resolves to when it is absent.
//
// USES THE SHARED HEADER AND FILTER SKELETONS rather than redrawing them. The
// hand-drawn versions applied the header's DESKTOP spacing at every width — `mb-5`,
// `pb-5`, `gap-3` where `SectionHeader` uses `mb-snug`, `pb-snug`, `gap-tight` below
// `md` — so the console header was roughly 24px too tall on a phone, and it drew a
// description line that the real header hides below `md`.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';


export default function AdminLoading() {
  return (
    <MarketplaceShellSkeleton title="Operations">
      <div className="min-w-0">
        <SectionHeaderSkeleton
          hasActions
          titleClassName="w-44"
          descriptionClassName="w-96"
        />

        <SectionFilterSkeleton tabs={3} />

        {/* THE CUSTODY PANEL, which this file used to omit entirely. `?tab=` defaults
            to Payouts, and Payouts leads with one `CustodyPanel` per Stripe platform
            account: `mb-section rounded-lg border p-group` around a wrapping heading
            row and three `<dl>` cells that stack to one column below `sm`. That is
            close to 400px sitting ABOVE everything this skeleton did draw, so the
            entire console slid down by a panel's height on swap.

            One panel, because a single-region deployment is the common case and a
            second would be a worse guess than a missing one. */}
        <section className="mb-section rounded-lg border border-border bg-muted p-group">
          <div className="mb-cozy flex flex-wrap items-center gap-snug">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            {/* `text-lead` heading, then the state and currency badges — which wrap
                to a second row on a phone, as they do in the real panel. */}
            <TextLines className="text-lead" widths={['w-56']} />
            <Skeleton className="h-6 w-28 shrink-0 rounded-md" />
            <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
          </div>
          <div className="grid gap-cozy sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index}>
                <TextLines className="text-meta" widths={['w-28']} />
                <TextLines className="mt-0.5 text-subhead" widths={['w-24']} />
                <TextLines
                  className="mt-0.5 text-body"
                  widths={['w-full', 'w-4/5']}
                />
              </div>
            ))}
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* `text-subhead` (23.8px), not `h-7`. */}
            <TextLines className="text-subhead" widths={['w-48']} />
            <Skeleton className="h-6 w-32 shrink-0 rounded-md" />
          </div>
          {/* `DrainPayoutsButton` is `size="sm"` — `h-8` below `md`, not `h-9`. */}
          <Skeleton className="h-8 w-36 shrink-0 rounded-md" />
        </div>

        {/* The queue's standing explanation is ~200 characters of `text-body`, which
            is four lines in the 343px the shell leaves on a 375px phone. It was one
            16px bar. */}
        <TextLines
          className="mb-4 text-body"
          widths={['w-full', 'w-full', 'w-full', 'w-3/5']}
        />

        {/* PLAIN CARDS, NOT ARTICULATED ROWS. The three `?tab=` values render three
            different row bodies behind this one skeleton — Payouts a `<dl>` grid and
            one button, Reports free text and a `ReportActions` group, Reconciliation
            neither — so the badge/title/timestamp/two-buttons arrangement that was
            here could only ever be right for one of them. What all three DO share is
            a `<Card>` in a `space-y-4` list, opening with a wrapping badge row and a
            `CardDescription`; below that this reserves one block and guesses nothing.

            `Card` also gets the container right: these were `rounded-xl border p-4`
            against `rounded-lg border bg-card shadow-market` with the padding split
            between `CardHeader` and `CardContent`. */}
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
                    <TextLines className="text-lead" widths={['w-40']} />
                  </div>
                  <TextLines className="shrink-0 text-meta" widths={['w-24']} />
                </div>
                <TextLines className="text-body" widths={['w-full', 'w-3/5']} />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
