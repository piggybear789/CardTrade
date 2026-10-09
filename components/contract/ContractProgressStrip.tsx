// components/contract/ContractProgressStrip.tsx
//
// The contract's progress as one thin segmented bar and a line of text — "Step 3 of 6
// · Post the card" — for the header strip and the phone chat bar.
//
// The full numbered rail lives in the Status tab, so on arrival a room showed only the
// live step: where it sat in the sequence, and how much was left, took a tab change to
// learn (and trades never drew the sequence at all). This is the glanceable version,
// small enough to ride along with the identity line. It reads the same `steps` the
// rail does, so the two cannot disagree.

import type { ContractStep } from '@/domain/contract';
import { cn } from '@/lib/utils';

export function ContractProgressStrip({
  steps,
  className,
}: {
  steps: readonly ContractStep[];
  className?: string;
}) {
  if (steps.length === 0) return null;
  const liveIndex = steps.findIndex((step) => step.status === 'active' || step.status === 'halted');
  const live = liveIndex >= 0 ? steps[liveIndex] : null;
  const allDone = liveIndex < 0 && steps.every((step) => step.status === 'done');
  const label = allDone
    ? 'All steps complete'
    : live
      ? `Step ${liveIndex + 1} of ${steps.length} · ${live.short ?? live.label}`
      : null;

  return (
    <div className={cn('flex min-w-0 items-center gap-cozy', className)}>
      <ol className="flex flex-1 gap-0.5" aria-hidden>
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              'h-1 flex-1 rounded-full',
              step.status === 'done'
                ? 'bg-foreground/70'
                : step.status === 'active'
                  ? 'bg-iris'
                  : step.status === 'halted'
                    ? 'bg-destructive'
                    : 'bg-border',
            )}
          />
        ))}
      </ol>
      {label ? (
        <p className="shrink-0 truncate text-meta text-muted-foreground">{label}</p>
      ) : null}
    </div>
  );
}
