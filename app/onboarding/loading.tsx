// app/onboarding/loading.tsx
//
// Onboarding is a centred dialog on a muted page — not a marketplace rail.
// Mirrors the welcome step: title, four rule rows, full-width accept button.

import { Skeleton } from '@/components/ui/skeleton';

export default function OnboardingLoading() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-4"
      aria-label="Loading onboarding"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <div className="w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-6 shadow-market sm:p-8">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-5 w-36" />
          <Skeleton className="mx-auto h-7 w-48" />
          <Skeleton className="mx-auto h-4 w-56 max-w-full" />
        </div>
        <ol className="mt-6 border-t border-border">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="flex gap-3 border-b border-border py-3.5">
              <Skeleton className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </li>
          ))}
        </ol>
        <Skeleton className="mt-6 h-11 w-full rounded-md" />
      </div>
    </main>
  );
}
