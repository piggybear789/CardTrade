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
        'relative flex w-full touch-none select-none items-center',
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
          className="relative block size-6 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 before:absolute before:-inset-2.5 before:content-['']"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
