// components/ui/choice-tile.tsx
//
// One bordered choice in a grid of a few mutually comparable options: control
// and icon sit in a row with the full label + hint stack, centred against it.
// Styled like the selectable rows in the trade offer card
// (`components/trade/TradeOfferForm.tsx`), but laid out as a tile so a small set
// of options sits side by side and can be read at a glance instead of scrolled.
//
// Works as either a radio or a checkbox; the caller owns the group and the
// selection.

import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

import { cn } from '@/lib/utils';

export interface ChoiceTileProps {
  /** Also the input's `value`, so the group's ids stay predictable. */
  id: string;
  name: string;
  type: 'radio' | 'checkbox';
  checked: boolean;
  onChange: () => void;
  icon?: IconSvgElement;
  label: string;
  /**
   * Short line beneath the label. OPTIONAL: where the options are
   * self-explanatory, a hint on each tile is noise that pushes the group taller
   * than the choice deserves. Omit it rather than passing an empty string, so the
   * tile collapses to a single row instead of reserving space for nothing.
   */
  hint?: string;
  /** Marks every tile in a group whose selection failed validation. */
  invalid?: boolean;
  /** `center` for short labels that fill a 2-up grid (deal compose). */
  align?: 'start' | 'center';
}

export function ChoiceTile({
  id,
  name,
  type,
  checked,
  onChange,
  icon: Icon,
  label,
  hint,
  invalid = false,
  align = 'start',
}: ChoiceTileProps) {
  return (
    // NO onClick ON THE LABEL. A label forwards its click to its input, which fires
    // `onChange` by itself. With a handler here as well, one click on the label ran
    // it three times (label, input, then the input's click bubbling back through the
    // label) and a click on the checkbox itself ran it twice, so a toggling handler
    // cancelled itself out. It also ran inside a disabled <fieldset>, because a
    // <label> cannot be disabled: ItemForm's locked listing kind switched in edit mode.
    <label
      htmlFor={id}
      className={cn(
        'relative flex cursor-pointer items-center gap-snug rounded-md border border-border p-snug text-body transition-colors md:p-cozy',
        // The whole tile takes the focus frame: at this size the native control's
        // own border is easy to miss. Edge plus 1px inset ring, like every field.
        'has-[:focus-visible]:border-iris has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-iris',
        // Hover darkens the hairline rather than tinting it violet: a violet hover
        // edge on an unselected tile would read as a second, weaker selection.
        //
        // SELECTED IS MORE THAN THE WASH. `bg-accent` is 1.14:1 against the page and
        // the label only changes hue, so with the radio visually hidden the chosen
        // tile was told apart by colour alone. The iris edge is the "you are here"
        // marker globals.css already allows for a selected gallery thumbnail, and the
        // accent-plus-iris pairing is what GenrePills uses for its active pill.
        checked
          ? 'border-iris bg-accent text-accent-foreground'
          : 'hover:border-foreground/20 hover:bg-muted/40',
        invalid && 'border-destructive',
        // Locked groups (a disabled <fieldset>) look and behave locked.
        'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-70',
        align === 'center' && 'justify-center text-center',
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        value={id}
        checked={checked}
        onChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={type === 'radio' ? 'sr-only' : 'size-4 shrink-0'}
      />
      {Icon ? (
        <HugeiconsIcon icon={Icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <span className="min-w-0 space-y-tight">
        <span className="block truncate font-medium">{label}</span>
        {hint ? (
          <span id={`${id}-hint`} className="block text-body text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
