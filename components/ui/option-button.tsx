'use client';

// components/ui/option-button.tsx
//
// One choice in a row or grid of buttons (a radio group built from buttons): the
// reference composer's Platform and Deal pickers, the handle-claim provider grid.
//
// SAME LOOK AS `ChoiceTile`, deliberately. That primitive is a <label> around a real
// input, for forms; this is a <button role="radio">, for pickers that set state
// directly. They must read as one control family, so they share `optionTileClass`:
// the `--input` edge every control rests at, and a neutral hover that only firms the
// edge. Height tracks `Button` (40px touch, 36px from `md`).
//
// SELECTED MUST BE OBVIOUS AT A GLANCE. It was a 1px dark edge on a near-white
// `bg-accent` (1.14:1 against the card), which members could not tell from the other
// tiles. It is now the standard shadcn treatment: the same 1px edge every tile has,
// darkened to foreground, on an 8% foreground fill (a step past `bg-muted`, which
// sat too close to the card), with a semibold label. Three cues,
// none of them colour alone, and no doubled frame (a 2px edge read as heavy beside
// the 1px controls around it). Neutral rather than primary: violet stays for actions,
// so a chosen tile does not read as a second call to action.

import * as React from 'react';

import { cn } from '@/lib/utils';

/** The selected look, shared with `ChoiceTile` so every picker in the app agrees. */
export const OPTION_SELECTED =
  'border-foreground bg-foreground/[0.08] font-semibold text-foreground';

/** The shared tile surface, for a picker that cannot use `OptionButton` itself. */
export function optionTileClass(selected: boolean): string {
  return cn(
    'rounded-md border bg-card text-body font-medium transition-colors',
    'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    selected
      ? OPTION_SELECTED
      : 'border-input text-foreground hover:border-foreground/60 hover:bg-muted/40',
  );
}

export interface OptionButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
  selected: boolean;
}

/** A radio-style choice button. Put a group of them inside an element with `role="radiogroup"`. */
export const OptionButton = React.forwardRef<HTMLButtonElement, OptionButtonProps>(
  ({ selected, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      role="radio"
      aria-checked={selected}
      className={cn(
        'flex h-10 min-w-0 touch-manipulation items-center gap-snug px-cozy md:h-9 [&_svg]:shrink-0',
        optionTileClass(selected),
        className,
      )}
      {...props}
    />
  ),
);
OptionButton.displayName = 'OptionButton';
