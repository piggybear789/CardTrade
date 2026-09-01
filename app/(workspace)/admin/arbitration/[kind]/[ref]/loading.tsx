// app/admin/arbitration/[kind]/[ref]/loading.tsx
//
// One case: section header with assign control, then the back link, the status strip,
// and the two-column context / decision workspace.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { SectionHeaderSkeleton } from '@/components/layout/WorkspaceSkeletons';
import { cn } from '@/lib/utils';


/**
 * One panel of either column: a `text-lead` CardTitle over a block of body.
 *
 * Deliberately unarticulated. The five panels this file used to draw — including a
 * `size-16` thumbnail and a bare `h-32` slab — described the LEFT column, which on a
 * phone is not the column that comes first. Getting the order right matters more than
 * getting any one card's interior right, and the interiors differ per case anyway
 * (evidence may be empty, a shipment may not exist).
 */
function CasePanelSkeleton({ bodyClassName }: { bodyClassName: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <TextLines className="text-lead" widths={['w-40']} />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn('w-full', bodyClassName)} />
      </CardContent>
    </Card>
  );
}

export default function ArbitrationCaseLoading() {
  return (
    <MarketplaceShellSkeleton title="Cases">
      <div className="min-w-0">
        {/* Shared, not redrawn — see the note in the queue's loading state.
            `CaseAssignButton` is `size="sm"`, so the action is `h-8` and not the `h-9`
            the shared header defaults to. */}
        <SectionHeaderSkeleton
          hasActions
          actionsClassName="h-8 w-28"
          titleClassName="w-64"
          descriptionClassName="w-80"
        />

        {/* `ArbitrationCaseView` opens with `space-y-section` over a back link and a
            status strip, neither of which had a placeholder here — roughly 150px that
            arrived on swap and pushed both columns down. */}
        <div className="space-y-section">
          {/* `inline-flex min-h-11 items-center`, so 44px. */}
          <div className="flex min-h-11 items-center gap-tight text-body">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="inline-block h-[0.9em] w-28 align-middle" />
          </div>

          {/* The status strip: priority, situation, age, deadline and the amount at
              stake in one `flex flex-wrap` band, which is two or three rows on a
              phone. */}
          <div className="flex flex-wrap items-center gap-snug rounded-lg border bg-muted px-group py-cozy">
            <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
            <Skeleton className="h-6 w-28 shrink-0 rounded-md" />
            <TextLines className="text-meta" widths={['w-32']} />
            <TextLines className="text-meta" widths={['w-36']} />
            <TextLines className="ml-auto text-body" widths={['w-24']} />
          </div>

          {/* `gap-section` and `space-y-section` (32px), not `gap-6` / `space-y-4`. */}
          <div className="grid gap-section lg:grid-cols-[1fr_380px]">
            {/* LEFT in the DOM: the claim, filed evidence, shipment, timeline. */}
            <div className="space-y-section">
              <CasePanelSkeleton bodyClassName="h-24" />
              <CasePanelSkeleton bodyClassName="h-24" />
              <CasePanelSkeleton bodyClassName="h-32" />
            </div>

            {/* `order-first lg:order-none`, copied from the real column rather than
                approximated: below `lg` the workspace — notes and the decision form —
                leads, and this file used to stack the context above it, so every case
                page opened on the wrong half on a phone. */}
            <div className="order-first space-y-section lg:order-none">
              <CasePanelSkeleton bodyClassName="h-40" />
              <CasePanelSkeleton bodyClassName="h-56" />
            </div>
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
