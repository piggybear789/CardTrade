// Neutral private-deal fallback. This route can resolve to either a guest
// preview or the signed-in workspace, so it must not inherit the catalog grid.

import { PageShell } from '@/components/layout/PageShell';
import { Skeleton } from '@/components/ui/skeleton';

export default function DealInviteLoading() {
  return (
    <PageShell
      centered
      className="max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10"
    >
      <div
        className="w-full rounded-xl border bg-card p-6 shadow-sm"
        role="status"
        aria-label="Loading private deal"
      >
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-snug h-4 w-64 max-w-full" />
        <div className="mt-6 space-y-cozy">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
        <Skeleton className="mt-6 h-10 w-32 rounded-md" />
      </div>
    </PageShell>
  );
}
