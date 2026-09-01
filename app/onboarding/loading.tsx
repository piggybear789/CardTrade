// app/onboarding/loading.tsx
//
// Mirrors the wizard's welcome step.
//
// ON A PHONE THE WIZARD IS THE PAGE. `OnboardingWizard` renders its dialog with
// `mobile="page"`, so below `md` it is a fixed full-viewport panel with safe-area
// padding and a footer pinned to the bottom — not the small centred `max-w-md` card
// this used to draw, which was a different shape at a different size in a different
// place. It also listed four rules; there are three (`WELCOME_POINTS`).

import { Skeleton, TextLines } from '@/components/ui/skeleton';


/**
 * How many lines each `WELCOME_POINTS` body wraps to.
 *
 * The bodies are 85, 91 and 100 characters of `text-body leading-relaxed`, and the
 * medallion and its `gap-cozy` leave about 299px beside them on a 375px phone — room
 * for roughly 46 characters a line. Two `h-4` bars used to stand for a title plus all
 * of this: 36px against 67-88px, three times over.
 */
const WELCOME_POINT_BODY_LINES = [2, 2, 3] as const;

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
          centred `max-w-2xl` card from `md` up. `border-0` below `md` because the
          mobile panel sets `rounded-none border-0 shadow-none` — it is the page, and a
          hairline down both edges of the viewport vanished on swap. */}
      <div className="fixed inset-x-0 bottom-0 top-0 z-50 flex w-full flex-col gap-4 border-0 bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-2rem)] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border md:p-6 md:shadow-lg">
        {/* `WIZARD_SCROLL` + `WIZARD_CENTER`: the step centres in the leftover height
            on a phone, so the skeleton has to sit where the real content will. */}
        <div className="max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-y-auto">
          <div className="space-y-group max-md:my-auto max-md:shrink-0">
            {/* `DialogHeader`'s `gap-1.5` and the wizard's own `space-y-2` are
                different twMerge groups, so both apply: 14px between title and
                description, not 8. */}
            <div className="flex flex-col gap-1.5 space-y-2 text-center">
              <div className="text-head">
                <Skeleton className="mx-auto inline-block h-[0.9em] w-56 max-w-full align-middle" />
              </div>
              <div className="text-body leading-relaxed">
                <Skeleton className="mx-auto inline-block h-[0.9em] w-72 max-w-full align-middle" />
              </div>
            </div>

            {/* Three promises, each an icon medallion beside a `text-body font-medium`
                title and a `text-body leading-relaxed` body. */}
            <ul className="space-y-cozy text-left">
              {WELCOME_POINT_BODY_LINES.map((bodyLines, index) => (
                <li key={index} className="flex items-center gap-cozy">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-tight">
                    <TextLines className="text-body" widths={['w-2/5']} />
                    <TextLines
                      className="text-body leading-relaxed"
                      widths={[
                        ...Array.from({ length: bodyLines - 1 }, () => 'w-full'),
                        'w-3/4',
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* `WizardFooter`: pinned to the bottom on a phone, right-aligned from `md`.
            `h-9` because "Get started" is a default `Button`; `h-10` was 4px taller
            than anything this footer holds. */}
        <div className="flex flex-row gap-2 max-md:mt-auto max-md:shrink-0 max-md:border-t max-md:pt-3 md:justify-end">
          <Skeleton className="h-9 w-full rounded-md md:w-32" />
        </div>
      </div>
    </main>
  );
}
