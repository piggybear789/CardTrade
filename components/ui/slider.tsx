'use client';

// components/ui/slider.tsx
//
// shadcn/ui slider, extended to render one thumb per value so it can express a
// range as well as a single point. Radix drives a thumb from each entry in
// `value`/`defaultValue`; the stock wrapper hard-codes a single thumb, which
// silently drops the second handle of a range.

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/lib/utils';

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  thumbLabels,
  thumbValueText,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof SliderPrimitive.Root> & {
  /**
   * Accessible name per thumb, in value order. A range slider's handles are
   * separate inputs, so "Minimum price" / "Maximum price" have to be named
   * individually — a label on the group does not reach them.
   */
  thumbLabels?: string[];
  /**
   * Spoken form of a thumb's value. Needed whenever the raw number is not what
   * the value means — a position on a scale, a duration, a formatted price —
   * since screen readers otherwise announce the bare number.
   */
  thumbValueText?: (value: number, index: number) => string;
}) {
  // Uncontrolled sliders still need the right number of thumbs, so fall back to
  // `defaultValue`, then to the bounds (a single thumb at `min`).
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min];

  return (
    <SliderPrimitive.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      className={cn(
        // `overflow-x-clip` contains the thumbs' hit area. Each thumb carries a
        // `before:-inset-3.5` pseudo-element to make a 20–24px circle comfortable
        // to grab, and at either end of the track that invisible box sticks ~10px
        // past the slider. Any ancestor with `overflow-y: auto` is a scroll
        // container on BOTH axes, so those 10px were enough to give the
        // marketplace rail a horizontal scrollbar and let the whole sidebar slide
        // sideways.
        //
        // `clip` rather than `hidden`, and x-only: `overflow-x: clip` is the one
        // value that pairs with `overflow-y: visible` without forcing the other
        // axis into a scroll box. So the vertical half of the hit area — the half
        // that matters on a 8px-tall track — is untouched, and only the sliver
        // beyond the track ends is trimmed. Nothing visible is clipped; the
        // pseudo-element has no paint.
        'relative flex w-full touch-none select-none items-center overflow-x-clip',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((thumbValue, index) => (
        <SliderPrimitive.Thumb
          key={index}
          aria-label={thumbLabels?.[index]}
          aria-valuetext={thumbValueText?.(thumbValue, index)}
          // 20px on touch, 24px from `md` — the reverse of the direction
          // `Button` runs, and for a different reason. A button's height IS its
          // hit area, so a phone needs the bigger one. A thumb's is the
          // `before:` box below, which is 28px larger than the circle at every
          // width, so the circle is pure ornament and can be sized on looks
          // alone. At 24px it was three times the 8px track it rides and read as
          // two beads on a string; the mobile filter column is also ~180px
          // narrower than the rail, which magnified it.
          //
          // 20 + 28 = a 48px target, well clear of SC 2.5.8's 24px floor.
          className="relative block size-5 md:size-6 rounded-full border-2 border-primary bg-background transition-colors focus-visible:border-iris focus-visible:outline-none disabled:pointer-events-none disabled:opacity-65 before:absolute before:-inset-3.5 before:content-['']"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
