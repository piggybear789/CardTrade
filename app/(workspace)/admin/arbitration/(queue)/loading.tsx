// app/admin/arbitration/loading.tsx
//
// The arbitration queue assembles itself from four record types plus assignments, notes
// and per-case held-funds figures, which makes it the heaviest read in the app. Without a
// skeleton it shows the generic root placeholder and then jumps, which on a page whose
// whole job is triage reads as "nothing is waiting".
//
// Mirrors the real page's geometry in order: section header, four summary tiles, the
// published triage rule, the three-tab strip, then case rows.

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
        {/* `hasActions`: the header carries an "Operations" hand-off at every width,
            and its ~150-character description wraps to two lines beside it. Drawn
            without either, the header stood 22px short and the stats, rule and tabs
            all rose on swap (measured by `skeleton-fidelity.spec.ts`). */}
        <SectionHeaderSkeleton
          hasActions
          titleClassName="w-24"
          descriptionLines={2}
          descriptionClassName="w-2/5"
        />

        {/* The four triage stats: a `text-meta` label (16.8px) over a `mt-0.5
            text-subhead` figure (23.8px), not `h-3` over `mt-snug h-6`.
            `bg-muted` tiles hid `bg-muted/70` bars entirely, so the bars step up to
            the border tone inside them. */}
        <div className="mb-6 grid grid-cols-2 gap-cozy sm:grid-cols-4 [&_.animate-skeleton]:bg-border/70">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-lg border bg-muted p-cozy">
              {/* Label over figure — both texture in their own line boxes, canonical. */}
              <TextLines className="text-meta" widths={['w-1/3']} />
              <TextLines className="mt-0.5 text-subhead" widths={['w-1/3']} />
            </div>
          ))}
        </div>

        {/* THE PUBLISHED TRIAGE RULE, which this file used to skip: a bordered
            `mb-5` band of ~200 characters of `text-meta` between the stats and the tab
            strip — four lines on a phone, two from `md` — so the strip and every row
            under it dropped by the band's height on arrival. */}
        <div className="mb-5 rounded-md border border-border bg-muted px-cozy py-snug [&_.animate-skeleton]:bg-border/70">
          <TextLines
            className="text-meta md:hidden"
            widths={['w-full', 'w-full', 'w-full', 'w-1/3']}
          />
          <TextLines className="hidden text-meta md:block" widths={['w-full', 'w-1/3']} />
        </div>

        <SectionFilterSkeleton labels={['All open', 'Mine', 'Unassigned']} />

        {/* `Card`, not `rounded-xl border p-group`: the real rows are
            `rounded-lg border bg-card shadow-market` with the padding split between
            `CardHeader className="pb-cozy"` and `CardContent`. */}
        <div className="space-y-cozy">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <CardHeader className="pb-cozy">
                <div className="flex flex-wrap items-center justify-between gap-snug">
                  <div className="flex min-w-0 flex-wrap items-center gap-snug">
                    {/* The two badges keep their honest `h-6` reserves; the title is
                        texture at `text-lead` (24px line box) and draws canonical. */}
                    <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
                    <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
                    {/* `CardTitle className="text-lead"` — 24px. */}
                    <TextLines className="text-lead" widths={['w-1/2']} />
                  </div>
                  <TextLines className="shrink-0 text-body" widths={['w-1/3']} />
                </div>
                {/* Age, deadline and note count: short spans in one wrapping
                    `CardDescription`, which is a single line in the common case. It was
                    drawn as two, 22px over the real row, four times over. Width is
                    canonical texture. */}
                <TextLines className="text-body" widths={['w-1/2']} />
              </CardHeader>
              {/* `space-y-cozy` over the PRIORITY REASON line and then the parties row.
                  The reason line had no placeholder, so every row grew by it on swap.
                  It is ~110 characters of `text-meta`: two lines on a phone, one from
                  `md`. */}
              <CardContent className="space-y-cozy">
                {/* The reason line's LINE COUNT and `md:` gates are the reservation;
                    the taper draws from the canonical set. */}
                <TextLines className="text-meta md:hidden" widths={['w-full', 'w-1/2']} />
                <TextLines className="hidden text-meta md:block" widths={['w-2/3']} />
                <div className="flex flex-wrap items-center justify-between gap-cozy">
                  <TextLines className="min-w-0 text-body" widths={['w-1/2']} />
                  {/* "Open case" and `CaseAssignButton` are both `size="sm"` — `h-9 md:h-8`. */}
                  <div className="flex items-center gap-snug">
                    <Skeleton className="h-9 w-24 shrink-0 rounded-md md:h-8" />
                    <Skeleton className="h-9 w-20 shrink-0 rounded-md md:h-8" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
