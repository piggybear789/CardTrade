// components/ui/segmented-control.tsx
//
// A binary-or-few MODE switch: the options are not items to compare, they are two
// readings of the same form, and picking one changes what the rest of it asks for.
//
// WHY IT IS NOT A `ChoiceTile` GRID. `ChoiceTile` is for a set of comparable
// options, each with its own outline. The deal composer stacked two of those grids —
// "What kind of deal?" then "Your side" — which drew four identically weighted
// bordered tiles and read as one flat set of four choices rather than a choice that
// reveals a second, narrower one. A segmented control is visibly a different KIND of
// control: one track, one selected segment, no per-option chrome.
//
// The visual language is the phone half of `TabbedPanels`, deliberately, so a
// segmented thing looks the same whether it is switching panels or switching a form
// mode. It is not built on that component: those segments are `<Link>`s driving
// `<Activity>` panels, and a form mode is neither a route nor a navigation.
//
// NATIVE RADIOS, visually hidden inside the labels. That buys arrow-key traversal,
// the roving tab stop, and form semantics from the browser rather than from a
// hand-written `role="radiogroup"` keyboard handler.

import { cn } from '@/lib/utils';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedControlProps<Value extends string> {
  /** Radio group name. Must be unique on the page. */
  name: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** Names the group for assistive tech when no visible `<legend>` precedes it. */
  label?: string;
  className?: string;
}

export function SegmentedControl<Value extends string>({
  name,
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<Value>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // `auto-cols-fr grid-flow-col` rather than `grid-cols-N`: the option count
        // varies by caller, and implicit columns give equal halves or thirds without
        // a lookup table keyed on length. `minmax(0, 1fr)` keeps `truncate` working.
        'grid auto-cols-fr grid-flow-col gap-tight rounded-lg bg-muted p-tight',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const id = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              'relative flex min-h-9 cursor-pointer touch-manipulation items-center justify-center rounded-md px-tight text-body font-medium transition-colors',
              // The segment takes the focus edge: the control it holds is hidden, so
              // there is nothing else for the ring to land on.
              'has-[:focus-visible]:border has-[:focus-visible]:border-iris',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span className="truncate">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
