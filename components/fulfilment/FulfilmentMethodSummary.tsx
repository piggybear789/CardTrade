// components/fulfilment/FulfilmentMethodSummary.tsx
//
// HOW THE GOODS CHANGE HANDS, as a settled fact rather than a control.
//
// The method is a negotiated term: both parties agreed it, and changing it means
// re-opening the terms dialog. So the room shows the pair of options with the
// agreed one marked, and leaves the changing to the dialog — the same shape as
// `FulfilmentMethodChoice`, minus the radios.
//
// It is deliberately NOT the picker rendered read-only. An inline radio pair
// implies the choice is yours to flip on the spot, which is exactly the wrong
// promise for a term the counterparty also has to live with.

import { HugeiconsIcon } from '@hugeicons/react';
import { MapPinIcon, TruckIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';
import type { FulfilmentMethod } from '@/domain/fulfilment';

const OPTIONS: {
  value: FulfilmentMethod;
  label: string;
  hint: string;
  icon: typeof MapPinIcon;
}[] = [
  {
    value: 'DELIVERY',
    label: 'Postage',
    hint: 'Posted with tracking',
    icon: TruckIcon,
  },
  {
    value: 'IN_PERSON',
    label: 'Face to face',
    hint: 'Meet and swap',
    icon: MapPinIcon,
  },
];

export interface FulfilmentMethodSummaryProps {
  /** The agreed method, or `null` while the parties are still deciding. */
  method: FulfilmentMethod | null;
  className?: string;
}

/** The agreed fulfilment method, shown against the option it was chosen over. */
export function FulfilmentMethodSummary({
  method,
  className,
}: FulfilmentMethodSummaryProps) {
  return (
    <div className={cn('grid gap-snug sm:grid-cols-2', className)}>
      {OPTIONS.map((option) => {
        const chosen = option.value === method;
        const Icon = option.icon;
        return (
          <div
            key={option.value}
            className={cn(
              'flex min-w-0 items-center gap-snug rounded-lg border p-cozy',
              chosen
                ? 'border-iris bg-iris/[0.07]'
                : // The option NOT taken stays visible and stays quiet. Dropping
                  // it entirely would leave a lone card that reads as a heading;
                  // showing it at equal weight would read as a live choice.
                  'border-border opacity-60',
            )}
          >
            <HugeiconsIcon icon={Icon}
              className={cn(
                'size-4 shrink-0',
                chosen ? 'text-iris-ink' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p
                className={cn(
                  'truncate text-body',
                  chosen ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {option.label}
              </p>
              <p className="truncate text-meta text-muted-foreground">
                {option.hint}
              </p>
            </div>
            {chosen ? <span className="sr-only">Agreed</span> : null}
          </div>
        );
      })}
    </div>
  );
}
