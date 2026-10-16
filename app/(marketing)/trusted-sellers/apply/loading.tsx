// app/(marketing)/trusted-sellers/apply/loading.tsx
//
// The apply page's own placeholder: a heading, then the form or the status card. The
// status card is drawn, because it is the shape a returning member sees; a first-time
// applicant's form is about the same height.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export default function TrustedSellerApplyLoading() {
  return (
    <article
      className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <TextLines className="text-subhead md:text-head" widths={['w-2/3']} />

      <div className="mt-section space-y-section">
        <div className="space-y-group rounded-lg border border-border p-group">
          <TextLines className="text-lead" widths={['w-1/2']} />
          <TextLines className="text-body leading-relaxed" widths={['w-full', 'w-full', 'w-1/3']} />
          <div className="flex flex-col gap-snug sm:flex-row">
            <Skeleton className="h-10 w-full rounded-md sm:flex-1" />
            <Skeleton className="h-10 w-36 rounded-md" />
          </div>
        </div>
        <TextLines className="text-body" widths={['w-1/3']} />
      </div>
    </article>
  );
}
