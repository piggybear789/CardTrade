// components/ui/skeleton.tsx
//
// Shared shimmer placeholder for loading states. Uses the muted token so it
// reads as "content is coming" on both themes, and respects reduced motion
// (the pulse is disabled globally by the prefers-reduced-motion rule).

import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/70', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Bars occupying exactly one line box each of the surrounding type style.
 *
 * Give it the real element's type classes and the reserved height comes from the
 * type scale rather than from an `h-4` picked by eye. That distinction is most of
 * why placeholders used to run short: `h-4` is 16px, but `text-body` is a 20.8px
 * line, `text-lead` is 24px and `text-head` is 26.25px, so a row of three bars
 * could be 20px under the content it stood for and a list of six under by 100px.
 * A `Label`, meanwhile, is `leading-none` at 13px — the same `h-4` overshoots it.
 *
 * Each width gets its own block so it lands on its own line whatever its width,
 * and the bar is `0.9em` so the usual half-leading survives above and below it
 * and a stack still reads as text rather than as one solid slab.
 *
 * @example
 * // Two wrapped lines of body copy, then a tighter caption.
 * <TextLines className="text-body" widths={['w-full', 'w-2/5']} />
 * <TextLines className="mt-0.5 text-meta" widths={['w-12']} />
 */
export function TextLines({
  className,
  widths,
}: {
  className?: string;
  widths: readonly string[];
}) {
  return (
    <div className={className}>
      {widths.map((width, index) => (
        <div key={index}>
          <Skeleton className={cn('inline-block h-[0.9em] align-middle', width)} />
        </div>
      ))}
    </div>
  );
}
