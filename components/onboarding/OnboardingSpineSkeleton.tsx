// components/onboarding/OnboardingSpineSkeleton.tsx
//
// The two-step verification spine's placeholder. Lifted out of
// `UnifiedOnboardingSurface` (a client module) so a route `loading.tsx` can draw
// the same shape: `/profile?tab=verification` used to show the PROFILE tab's rows
// while it loaded, because the hub's loader could only draw one tab.
//
// SHAPED LIKE THE SPINE IT REPLACES: two marker-plus-text rows at the same widths
// and heights. The action sits on the FIRST step, because `OnboardingStep` renders
// its children only while `active`, and step two stays `upcoming` until identity
// passes. The 3px rail that runs the height of both steps has a placeholder too;
// the gap between steps is `pb-section` INSIDE the content column, not a hard break
// across both, which is what keeps that rail continuous.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function OnboardingSpineSkeleton() {
  return (
    <div className="grid gap-0" role="status" aria-label="Loading your setup">
      {[0, 1].map((row) => (
        <div key={row} className="grid grid-cols-[auto_1fr] gap-x-group">
          <div className="flex flex-col items-center">
            <span aria-hidden className="w-[3px] flex-1 rounded-full bg-transparent" />
            <Skeleton className="my-tight size-7 shrink-0 rounded-full" />
            <span
              aria-hidden
              className={cn(
                'w-[3px] flex-1 rounded-full',
                row === 0 ? 'bg-border' : 'bg-transparent',
              )}
            />
          </div>
          <div className="min-w-0 py-tight">
            <div className="flex flex-col gap-cozy sm:flex-row sm:items-start sm:justify-between sm:gap-group">
              <div className="min-w-0 flex-1">
                <TextLines className="text-lead" widths={['w-40']} />
                {/* Both step descriptions run past 75 characters, so they wrap
                    in the content column. */}
                <TextLines className="mt-tight text-body" widths={['w-full', 'w-2/3']} />
              </div>
              {row === 0 ? (
                <Skeleton className="h-9 w-full shrink-0 rounded-md sm:w-44" />
              ) : null}
            </div>
          </div>
          <div className="flex justify-center">
            <span
              aria-hidden
              className={cn('w-[3px] rounded-full', row === 0 ? 'bg-border' : 'bg-transparent')}
            />
          </div>
          <div className={cn('min-w-0', row === 0 ? 'pb-section' : 'pb-0')} />
        </div>
      ))}
    </div>
  );
}
