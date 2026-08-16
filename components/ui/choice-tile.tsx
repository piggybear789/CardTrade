// components/ui/choice-tile.tsx
//
// One bordered choice in a grid of a few mutually comparable options: control,
// icon and label on the first line, a short hint beneath. Styled like the
// selectable rows in the trade offer card (`components/trade/TradeOfferForm.tsx`),
// but laid out as a tile so a small set of options sits side by side and can be
// read at a glance instead of scrolled.
//
// Works as either a radio or a checkbox; the caller owns the group and the
// selection.

import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ChoiceTileProps {
  /** Also the input's `value`, so the group's ids stay predictable. */
  id: string;
  name: string;
  type: 'radio' | 'checkbox';
  checked: boolean;
  onChange: () => void;
  icon?: LucideIcon;
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
}: ChoiceTileProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer flex-col gap-tight rounded-md border p-cozy text-body ring-offset-background transition-colors',
        // The whole tile takes the focus ring: at this size the native control's
        // own ring is easy to miss.
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
        invalid && 'border-destructive',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <input
          id={id}
          type={type}
          name={name}
          value={id}
          checked={checked}
          onChange={onChange}
          className="size-4 shrink-0"
        />
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <span className="min-w-0 truncate font-medium">{label}</span>
      </span>
      {hint ? (
        <span className="text-meta leading-4 text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}
