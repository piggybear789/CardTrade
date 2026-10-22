'use client';

// components/sales/PayMethodOptions.tsx
//
// The "how do you want to pay" choice on a cash sale's Pay step (0158). Each option
// states its clean rate ("1.5% + EUR 0.60"), its service fee and the total it charges,
// priced by the same function the
// server re-derives the charge with (`totalForMethod`), so the figure beside an option
// is the figure that option charges. Card is priced at the buyer's own card's tier
// (0159), and says so when that is a dearer one. With only card available it renders
// nothing, and the Pay dialog reads exactly as it did before bank rails existed.
//
// A radio group, not tiles in a grid: the fee and total are the point of the choice, so
// every option is one full-width row with its numbers aligned on the right where they
// can be compared at a glance.

import { HugeiconsIcon } from '@hugeicons/react';
import { BankIcon, CreditCardIcon } from '@hugeicons/core-free-icons';

import {
  paymentMethodDefinition,
  serviceFeeForMethod,
  totalForMethod,
  type MethodPricingFacts,
  type PaymentMethodKind,
} from '@/domain/payments/paymentMethods';
import { PROCESSING_FEE_NAME, cardTierClause, processingFeeRateLabel } from '@/lib/fees/feeLabels';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export function PayMethodOptions({
  methods,
  selected,
  onSelect,
  pricing,
  cardMethod = 'CARD',
  disabled = false,
}: {
  /** The rails this buyer may use, card first (`paymentMethodsFor`). */
  methods: readonly PaymentMethodKind[];
  selected: PaymentMethodKind;
  onSelect: (method: PaymentMethodKind) => void;
  pricing: MethodPricingFacts;
  /**
   * What the buyer's own card is priced as (0159, `cardMethodFor`): a card issued
   * outside the seller's card zone carries a dearer tier. Prices the Card option.
   */
  cardMethod?: PaymentMethodKind;
  disabled?: boolean;
}) {
  if (methods.length < 2) return null;
  const money = (minor: number) => formatMoney(minor, pricing.currency);
  const priceAs = (method: PaymentMethodKind): PaymentMethodKind => (method === 'CARD' ? cardMethod : method);
  const cheapest = Math.min(...methods.map((method) => totalForMethod(pricing, priceAs(method))));

  return (
    <fieldset className="grid gap-snug" disabled={disabled}>
      <legend className="mb-snug text-body font-medium">How do you want to pay?</legend>
      {methods.map((method) => {
        const def = paymentMethodDefinition(method);
        const priced = priceAs(method);
        const fee = serviceFeeForMethod(pricing, priced);
        const total = totalForMethod(pricing, priced);
        const tierClause = cardTierClause(pricing.currency, priced);
        const id = `pay-method-${method.toLowerCase()}`;
        const checked = selected === method;
        return (
          <label
            key={method}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-start gap-cozy rounded-md border border-input bg-card p-cozy text-body transition-colors',
              'has-[:focus-visible]:border-ring',
              checked ? 'border-foreground bg-accent text-accent-foreground' : 'hover:border-foreground/60 hover:bg-muted/40',
              'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-70',
            )}
          >
            <input
              id={id}
              type="radio"
              name="pay-method"
              value={method}
              checked={checked}
              onChange={() => onSelect(method)}
              aria-describedby={`${id}-detail`}
              className="mt-1 size-4 shrink-0"
            />
            <HugeiconsIcon
              icon={method === 'CARD' ? CreditCardIcon : BankIcon}
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden
            />
            <span className="min-w-0 flex-1 space-y-tight">
              <span className="flex flex-wrap items-baseline gap-x-snug">
                <span className="font-medium">{def.label}</span>
                {total === cheapest && methods.length > 1 ? (
                  <span className="text-meta font-medium text-trust">Lowest fee</span>
                ) : null}
              </span>
              <span id={`${id}-detail`} className="block text-muted-foreground">
                {def.description}{' '}
                <span className="whitespace-nowrap">
                  {PROCESSING_FEE_NAME} {processingFeeRateLabel(pricing.currency, priced)}: {money(fee)}.
                </span>
                {tierClause ? <span className="block">That is {tierClause}.</span> : null}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-semibold tabular-nums">{money(total)}</span>
              <span className="block text-meta text-muted-foreground">total</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
