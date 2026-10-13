'use client';

// components/ui/step-progress.tsx
//
// The progress bar a stepped form shows under its title: one short bar per step,
// filled up to the current one. Shared by the private-deal composer (`DealSteps`) and
// the listing form (`ItemForm`), so the two flows' progress always looks the same.
//
// TWO MODES. Without `onSelect` it is decorative — `aria-hidden`, because the step
// title beside it already says "Step N of 3" — and its DOM is exactly the bar the deal
// dialog drew inline before this existed. With `onSelect` it is navigation: a labelled
// list of real buttons, the current one marked `aria-current="step"`, each step named
// under its bar so a seller can see where a jump would take them.

import { cn } from '@/lib/utils';

/** Static so Tailwind sees each class; the step count picks one. */
const COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

export interface StepProgressProps {
  /** Each step's name, in order (2–4). Shown only in the interactive mode. */
  steps: readonly string[];
  /** The current step, 1-based. */
  current: number;
  /** Makes the bar navigation. Called with the 1-based step chosen. */
  onSelect?: (step: number) => void;
  /** Whether a step may be chosen. Defaults to every step. */
  canSelect?: (step: number) => boolean;
  className?: string;
}

export function StepProgress({
  steps,
  current,
  onSelect,
  canSelect = () => true,
  className,
}: StepProgressProps) {
  const numbers = steps.map((_, index) => index + 1);
  const bar = (n: number) =>
    n <= current ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-muted';

  if (!onSelect) {
    return (
      <div className={cn('grid gap-tight', COLS[steps.length], className)} aria-hidden>
        {numbers.map((n) => (
          <span key={n} className={bar(n)} />
        ))}
      </div>
    );
  }

  return (
    <nav aria-label="Form steps">
      <ol className={cn('grid gap-tight', COLS[steps.length], className)}>
        {numbers.map((n) => (
          <li key={n} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(n)}
              disabled={!canSelect(n)}
              aria-current={n === current ? 'step' : undefined}
              className="flex min-h-8 w-full min-w-0 flex-col gap-tight rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris disabled:cursor-not-allowed"
            >
              <span className={cn('w-full', bar(n))} aria-hidden />
              <span
                className={cn(
                  'text-meta',
                  n === current ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="sr-only">Step {n}: </span>
                {steps[n - 1]}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
