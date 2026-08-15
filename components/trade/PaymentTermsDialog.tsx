'use client';

// components/trade/PaymentTermsDialog.tsx
//
// The Payment Terms on a Trade offer: a cash adjustment either way, what you say
// your own side is worth, and a note to the other Trader. All optional — a
// straight goods-for-goods swap leaves every field here blank.
//
// These are edited in a dialog for the same reason the unlisted-item form is —
// they are four fields that only some offers use, and expanding them inline
// pushed the running total off screen. The offer card keeps a one-line summary
// of whatever is set, so nothing is hidden, just folded away.
//
// Amounts are held as the raw dollar strings the inputs produced. The offer form
// converts to integer AUD cents at the boundary, so a half-typed "12." never
// becomes a number here.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TRADE_PROPOSAL_MESSAGE_MAX } from '@/lib/marketplace-constants';
/**
 * Who pays the cash leg of a trade. Declared here rather than imported now that
 * the proposal module is gone; the database enum is `trade_cash_direction`.
 */
export type TradeCashDirection = 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';

/** The optional side of an offer, as typed. */
export interface PaymentTerms {
  /** Cash amount in dollars, as entered; '' means no cash component. */
  cashDollars: string;
  cashDirection: TradeCashDirection;
  /** What the proposer says their whole side is worth, in dollars, as entered. */
  valueDollars: string;
  message: string;
}

/** An offer with no optional terms: goods only, no note. */
export const EMPTY_PAYMENT_TERMS: PaymentTerms = {
  cashDollars: '',
  cashDirection: 'PROPOSER_PAYS',
  valueDollars: '',
  message: '',
};

export interface PaymentTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The terms currently on the offer, which seed the fields on open. */
  terms: PaymentTerms;
  /** Who is on the other side, for the cash direction copy. */
  counterpartName: string;
  /**
   * Dollar string shown as the valuation placeholder: the listed total of the
   * goods put up so far, so leaving it blank has an obvious meaning.
   */
  valuePlaceholder: string;
  onSave: (terms: PaymentTerms) => void;
}

export function PaymentTermsDialog({
  open,
  onOpenChange,
  terms,
  counterpartName,
  valuePlaceholder,
  onSave,
}: PaymentTermsDialogProps) {
  const [draft, setDraft] = useState<PaymentTerms>(terms);

  // Re-seed on open so cancelling leaves the committed terms untouched.
  useEffect(() => {
    if (open) setDraft(terms);
  }, [open, terms]);

  /** Update one field, leaving the rest of the draft alone. */
  function set<K extends keyof PaymentTerms>(key: K, value: PaymentTerms[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-3">
        <DialogHeader className="space-y-1">
          <DialogTitle>Payment Terms</DialogTitle>
          <DialogDescription>
            Cash adjustments are handled by Stripe. Valuation and a note
            are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-body font-medium">Cash adjustment</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  [
                    'PROPOSER_PAYS',
                    'I add cash',
                    `You pay ${counterpartName} through Stripe.`,
                  ],
                  [
                    'COUNTERPART_PAYS',
                    'I request cash',
                    `${counterpartName} pays you through Stripe.`,
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-start gap-snug rounded-md border p-snug text-body ring-offset-background transition-colors',
                    // The row carries the focus ring, matching the item rows on
                    // the offer card.
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
                    draft.cashDirection === value && 'border-primary bg-primary/5',
                  )}
                >
                  <input
                    type="radio"
                    name="terms-cash-direction"
                    value={value}
                    checked={draft.cashDirection === value}
                    onChange={() => set('cashDirection', value)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="mt-0.5 block text-body text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-tight">
              <Label htmlFor="terms-cash">Cash</Label>
              <MoneyInput
                id="terms-cash"
                value={draft.cashDollars}
                onChange={(e) => set('cashDollars', e.target.value)}
              />
            </div>

            <div className="space-y-tight">
              <Label htmlFor="terms-value">Your side is worth</Label>
              <Input
                id="terms-value"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                autoComplete="off"
                placeholder={valuePlaceholder}
                value={draft.valueDollars}
                onChange={(e) => set('valueDollars', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-tight">
            <Label htmlFor="terms-message">Note</Label>
            <Textarea
              id="terms-message"
              value={draft.message}
              onChange={(e) => set('message', e.target.value)}
              maxLength={TRADE_PROPOSAL_MESSAGE_MAX}
              rows={2}
              placeholder="Anything you want them to know…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save terms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
