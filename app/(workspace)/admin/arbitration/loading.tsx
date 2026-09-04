// app/admin/arbitration/loading.tsx
//
// The arbitration queue assembles itself from four record types plus assignments, notes
// and per-case held-funds figures, which makes it the heaviest read in the app. Without a
// skeleton it shows the generic root placeholder and then jumps, which on a page whose
// whole job is triage reads as "nothing is waiting".
//
// Mirrors the real page's geometry in order: section header, four summary tiles, the
// three-tab strip, then case rows.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';


export default function ArbitrationLoading() {
  return (
    // No `hasPrimaryAction`: the queue passes no rail CTA, and reserving a button's
    // height here would drop the rail by that much when the real shell arrives.
    <MarketplaceShellSkeleton title="Cases">
      <div className="min-w-0">
        {/* Shared, not redrawn: the hand-drawn copy applied `SectionHeader`'s desktop
            spacing at every width and drew a description the real header hides below
            `md`. */}
        <SectionHeaderSkeleton titleClassName="w-56" descriptionClassName="w-80" />

        {/* The four triage stats: a `text-meta` label (16.8px) over a `mt-0.5
            text-subhead` figure (23.8px), not `h-3` over `mt-2 h-6`. */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-lg border bg-muted p-3">
              <TextLines className="text-meta" widths={['w-20']} />
              <TextLines className="mt-0.5 text-subhead" widths={['w-14']} />
            </div>
          ))}
        </div>

        <SectionFilterSkeleton tabs={3} />

        {/* `Card`, not `rounded-xl border p-4`: the real rows are
            `rounded-lg border bg-card shadow-market` with the padding split between
            `CardHeader className="pb-3"` and `CardContent`. */}
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
                    <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
                    {/* `CardTitle className="text-lead"` — 24px. */}
                    <TextLines className="text-lead" widths={['w-44']} />
                  </div>
                  <TextLines className="shrink-0 text-body" widths={['w-20']} />
                </div>
                {/* Age, deadline and note count in one wrapping `CardDescription`. */}
                <TextLines className="text-body" widths={['w-full', 'w-2/5']} />
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <TextLines className="min-w-0 text-body" widths={['w-52']} />
                {/* "Open case" and `CaseAssignButton` are both `size="sm"` — `h-8`. */}
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
                  <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
