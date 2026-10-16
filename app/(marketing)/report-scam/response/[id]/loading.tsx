// app/(marketing)/report-scam/response/[id]/loading.tsx
//
// The response page's placeholder: the heading, the "what happens next" box and the
// response form.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export default function ScamReportResponseLoading() {
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
        <TextLines className="text-body md:text-lead" widths={['w-full', 'w-full', 'w-1/2']} />
      </div>

      <div className="mt-section space-y-group">
        <div className="space-y-tight rounded-xl border border-border p-group">
          <TextLines className="text-body" widths={['w-1/3']} />
          <TextLines className="text-body" widths={['w-full', 'w-full', 'w-2/3']} />
        </div>
        <div className="space-y-group rounded-xl border border-border p-group md:p-section">
          <TextLines className="text-lead" widths={['w-1/4']} />
          <Skeleton className="h-48 w-full rounded-md" />
          <div className="flex justify-end">
            <Skeleton className="h-10 w-36 rounded-md" />
          </div>
        </div>
      </div>
    </article>
  );
}
