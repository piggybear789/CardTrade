// app/sales/[id]/loading.tsx
//
// Streaming fallback for the cash-sale contract room. Shows the shell chrome
// and a content-area skeleton that approximates the header + action card +
// detail panel layout, without fetching anything.

import { Skeleton } from '@/components/ui/skeleton';

export default function ContractRoomLoading() {
  return (
    <div
      className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading contract…</span>
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="hidden h-7 w-24 rounded-full sm:block" />
      </div>
      {/* Progress rail */}
      <Skeleton className="mb-6 h-2 w-full rounded-full" />
      {/* Action card */}
      <div className="mb-6 rounded-xl border border-border/70 p-5">
        <Skeleton className="mb-3 h-5 w-56" />
        <Skeleton className="mb-4 h-4 w-full max-w-md" />
        <Skeleton className="h-10 w-36 rounded-md" />
      </div>
      {/* Detail panel */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded-md" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
