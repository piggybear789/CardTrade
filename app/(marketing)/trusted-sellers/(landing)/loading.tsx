// app/(marketing)/trusted-sellers/(landing)/loading.tsx
//
// /trusted-sellers' own placeholder, in a LEAF position so it never stands in for the
// apply page. Geometry follows `page.tsx`: a header row with the Apply button, the
// table, then the short apply section, in a `max-w-4xl` column.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

// Toolbar plus row list, matching `TrustedSellerDirectory`.

export default function TrustedSellersLoading() {
  return (
    <article
      className="mx-auto max-w-4xl px-group py-section sm:px-6 md:py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <div className="space-y-snug">
        <TextLines className="text-meta" widths={['w-48']} />
        <div className="flex flex-wrap items-center justify-between gap-cozy">
          <TextLines className="w-1/2 text-head md:text-[2.5rem] md:leading-tight" widths={['w-full']} />
          <Skeleton className="h-10 w-32 shrink-0 rounded-md" />
        </div>
        <TextLines className="max-w-xl text-body md:text-lead" widths={['w-full', 'w-2/3']} />
      </div>

      <div className="mt-section space-y-cozy">
        {/* Toolbar: count, search, sort. */}
        <div className="flex flex-col gap-snug sm:flex-row sm:items-center">
          <TextLines className="text-body sm:w-20" widths={['w-20']} />
          <Skeleton className="h-10 w-full flex-1 rounded-full" />
          <Skeleton className="h-10 w-full rounded-full sm:w-44" />
        </div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center gap-cozy px-cozy py-snug">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <TextLines className="text-body" widths={['w-1/3']} />
                <TextLines className="text-meta" widths={['w-2/3']} />
              </div>
              <TextLines className="hidden w-32 shrink-0 text-body sm:block" widths={['w-2/3']} />
              <Skeleton className="h-9 w-16 shrink-0 rounded-full sm:w-36" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-region max-w-2xl space-y-snug">
        <TextLines className="text-lead" widths={['w-1/3']} />
        <TextLines className="text-body" widths={['w-full', 'w-full', 'w-1/2']} />
        <TextLines className="text-body" widths={['w-1/2']} />
      </div>
    </article>
  );
}
