// components/ui/skeleton.tsx
//
// Shared shimmer placeholder for loading states. Uses the muted token so it
// reads as "content is coming" on both themes, and respects reduced motion
// (the pulse is disabled globally by the prefers-reduced-motion rule).
//
// `animate-skeleton`, NOT Tailwind's `animate-pulse` — see the keyframe comment
// in `app/globals.css`. The short version: `animate-pulse` bottoms out at 50%
// opacity, which is unobjectionable on one phone card and turns a desktop
// loader's sixty-odd synchronised bars into the whole viewport blinking. Every
// placeholder in the app draws through this component, so the amplitude is set
// here once rather than per loader.

import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-skeleton rounded-md bg-muted/70', className)}
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
 * why placeholders used to run short: `h-4` is 16px, but `text-body` is a 22.4px
 * line, `text-lead` is 24px and `text-head` is 26.25px, so a row of three bars
 * could be 20px under the content it stood for and a list of six under by 100px.
 * A `Label`, meanwhile, is `leading-none` at 14px — the same `h-4` overshoots it.
 *
 * Each width gets its own block so it lands on its own line whatever its width,
 * and the bar is `0.9em` so the usual half-leading survives above and below it
 * and a stack still reads as text rather than as one solid slab.
 *
 * CONVENTION: a width here is TEXTURE, not geometry — the bar sits inside its own
 * line box and the type-scale class (`text-body`, `text-lead`, …) is what reserves
 * the row's height, so the fraction only decides how far the bar runs across a
 * column that is already as wide as it is going to be. To keep the app's many
 * loaders reading as one calm, even surface rather than a ragged spread of bar
 * lengths, draw texture runs from the small canonical set `{w-1/3, w-1/2, w-2/3,
 * w-full}` and taper a final wrapped line to `w-1/3` or `w-1/2`. Reach for a
 * literal fraction or `w-[Nch]`/`w-N` only when the width is genuinely LOAD-BEARING
 * — i.e. it reserves space other content lines up against (a `ch`-sized tab label,
 * a figure another column aligns to). Those stay exact; everything else collapses to
 * the canonical set.
 *
 * @example
 * // Two wrapped lines of body copy, then a tighter caption.
 * <TextLines className="text-body" widths={['w-full', 'w-1/3']} />
 * <TextLines className="mt-0.5 text-meta" widths={['w-1/3']} />
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
