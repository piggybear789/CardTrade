'use client';

// components/fulfilment/FulfilmentMethodChoice.tsx
//
// The "how do the goods change hands" picker, shared by the Cash_Sale and 2-way
// Trade rooms.
//
// It was two components: a `Select` in `CashSaleTermsDialog` and a pair of
// `ChoiceTile`s in `TradeHandoverTermsEditor`. Same decision, two presentations and
// two sets of copy, so the same choice read differently depending on which room you
// were standing in.

import { MapPin, Truck } from 'lucide-react';

import { ChoiceTile } from '@/components/ui/choice-tile';
import type { FulfilmentMethod } from '@/domain/fulfilment';

/** Copy for each option, phrased for whoever is choosing. */
const OPTIONS: {
  value: FulfilmentMethod;
  label: string;
  hint: string;
  icon: typeof MapPin;
}[] = [
  {
    value: 'IN_PERSON',
    label: 'Face to face',
    hint: 'Meet and swap',
    icon: MapPin,
  },
  {
    value: 'DELIVERY',
    label: 'Delivery',
    hint: 'Post it with tracking',
    icon: Truck,
  },
];

export interface FulfilmentMethodChoiceProps {
  /** Unique per form, so two pickers on one page do not share a radio group. */
  name: string;
  value: FulfilmentMethod | null;
  onChange: (method: FulfilmentMethod) => void;
  disabled?: boolean;
  /** Override the group label. */
  legend?: string;
}

/** Radio-group choice between the two fulfilment methods. */
export function FulfilmentMethodChoice({
  name,
  value,
  onChange,
  disabled = false,
  legend = 'How the goods change hands',
}: FulfilmentMethodChoiceProps) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map((option) => (
          <ChoiceTile
            key={option.value}
            id={`${name}-${option.value}`}
            name={name}
            type="radio"
            icon={option.icon}
            label={option.label}
            hint={option.hint}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}
