// app/onboarding/loading.tsx
//
// Mirrors the wizard's welcome step.
//
// ON A PHONE THE WIZARD IS THE PAGE. `OnboardingWizard` renders its dialog with
// `mobile="page"`, so below `md` it is a fixed full-viewport panel with safe-area
// padding and a footer pinned to the bottom — not the small centred `max-w-md` card
// this used to draw, which was a different shape at a different size in a different
// place. It also listed four rules; there are three (`WELCOME_POINTS`).

import { Skeleton } from '@/components/ui/skeleton';

export default function OnboardingLoading() {
  return (
    <main
      className="min-h-[calc(100dvh-4rem-env(safe-area-inset-top))] bg-muted/30"
      aria-label="Loading onboarding"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>

      {/* Geometry copied from `DialogContent mobile="page"`: full viewport below `md`,
          centred `max-w-2xl` card from `md` up. */}
      <div className="fixed inset-x-0 bottom-0 top-0 z-50 flex w-full flex-col gap-4 border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-2rem)] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:p-6 md:shadow-lg">
        <div className="max-md:min-h-0 max-md:flex-1">
          <div className="space-y-group">
            <div className="space-y-2 text-center">
              <div className="text-head">
                <Skeleton className="mx-auto inline-block h-[0.9em] w-56 max-w-full align-middle" />
              </div>
              <div className="text-body">
                <Skeleton className="mx-auto inline-block h-[0.9em] w-72 max-w-full align-middle" />
              </div>
            </div>

            {/* Three promises, each an icon medallion beside two lines of copy. */}
            <ul className="space-y-cozy text-left">
              {Array.from({ length: 3 }, (_, index) => (
                <li key={index} className="flex items-center gap-cozy">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-tight">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* `WizardFooter`: pinned to the bottom on a phone, right-aligned from `md`. */}
        <div className="flex flex-row gap-2 max-md:mt-auto max-md:shrink-0 max-md:border-t max-md:pt-3 md:justify-end">
          <Skeleton className="h-10 w-full rounded-md md:w-32" />
        </div>
      </div>
    </main>
  );
}
