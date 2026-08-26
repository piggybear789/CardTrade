// app/(marketing)/loading.tsx
//
// Help, Terms, and Privacy are a single prose column.

import { Skeleton } from '@/components/ui/skeleton';

export default function MarketingLoading() {
  return (
    <article
      // `py-8 md:py-12`, matching `policy-article.tsx`. A flat `py-12` put an extra
      // 16px above and below the column on every phone.
      className="mx-auto max-w-3xl px-6 py-8 md:py-12 lg:px-8"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      <div className="mt-8 space-y-6">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </article>
  );
}
