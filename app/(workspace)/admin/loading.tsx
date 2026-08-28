// app/admin/loading.tsx
//
// Operations console chrome: section header with the Cases hand-off, the three queue
// tabs, then list rows.
//
// USES THE SHARED HEADER AND FILTER SKELETONS rather than redrawing them. The
// hand-drawn versions applied the header's DESKTOP spacing at every width — `mb-5`,
// `pb-5`, `gap-3` where `SectionHeader` uses `mb-snug`, `pb-snug`, `gap-tight` below
// `md` — so the console header was roughly 24px too tall on a phone, and it drew a
// description line that the real header hides below `md`.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function AdminLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <SectionHeaderSkeleton
          hasActions
          titleClassName="w-44"
          descriptionClassName="w-96"
        />

        <SectionFilterSkeleton tabs={3} />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
        </div>
        <Skeleton className="mb-4 h-4 w-full max-w-2xl" />

        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-48" />
                </div>
                <Skeleton className="h-4 w-24 shrink-0" />
              </div>
              <Skeleton className="mt-3 h-3 w-72 max-w-full" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
