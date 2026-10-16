// app/(marketing)/report-scam/(form)/loading.tsx
//
// The report page's own placeholder: the heading, the "do these first" box, then the
// first card of the form. A leaf loader in the `(form)` group so it never stands in
// for the response page beside it.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export default function ReportScamLoading() {
  return (
    <article
      className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <div className="space-y-snug">
        <TextLines className="text-meta" widths={['w-1/4']} />
        <TextLines className="text-head" widths={['w-2/3']} />
        <TextLines className="text-body md:text-lead" widths={['w-full', 'w-2/3']} />
      </div>

      <div className="mt-section space-y-group">
        <div className="space-y-tight rounded-xl border border-border p-group">
          <TextLines className="text-body" widths={['w-1/3']} />
          <TextLines className="text-body" widths={['w-full', 'w-full', 'w-1/2']} />
        </div>
        <div className="space-y-group rounded-xl border border-border p-group md:p-section">
          <TextLines className="text-lead" widths={['w-1/3']} />
          <Skeleton className="h-48 w-full rounded-md" />
          <div className="grid gap-group sm:grid-cols-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </div>
      </div>
    </article>
  );
}
