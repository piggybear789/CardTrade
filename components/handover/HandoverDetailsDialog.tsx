'use client';

// components/deals/HandoverDetailsDialog.tsx
//
// Where and when the goods change hands, edited away from the deal form.
//
// Same reasoning as the trade flow's dialogs (components/trade/
// PaymentTermsDialog.tsx): the meeting picker carries a search box and a map, so
// expanding it inline doubled the height of the new-deal card and pushed the
// submit button off screen. Held here, the card keeps one row with a summary of
// whatever is set.
//
// Which fields appear depends on the handover method chosen on the card: a
// meeting place and optional time for a face-to-face, a delivery cost for a
// posted deal. Nothing is validated as money here — the amount is handed back as
// the raw dollar string the input produced and converted to integer AUD cents at
// the form's boundary.

import { useEffect, useState } from 'react';

import { PlacePicker } from '@/components/location';
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
import type { PlaceValue } from '@/lib/location/types';
import type { HandoverMethod } from '@/lib/actions/deals';

/** The handover details a deal can carry, as typed. */
export interface HandoverDetails {
  place: PlaceValue | null;
  /** `datetime-local` value; '' means no time agreed yet. */
  meetingAt: string;
  /** Delivery cost in dollars, as entered; '' means nothing entered. */
  deliveryCostDollars: string;
}

export const EMPTY_HANDOVER_DETAILS: HandoverDetails = {
  place: null,
  meetingAt: '',
  deliveryCostDollars: '',
};

/** True when the details cover what the chosen method requires. */
export function isHandoverComplete(
  method: HandoverMethod,
  details: HandoverDetails,
): boolean {
  if (method === 'IN_PERSON') return Boolean(details.place?.label.trim());
  return /^(?:\d+|\d*\.\d{1,2})$/.test(details.deliveryCostDollars.trim());
}

export interface HandoverDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Decides which fields this dialog shows. */
  method: HandoverMethod;
  /** The details currently on the deal, which seed the fields on open. */
  value: HandoverDetails;
  /** A validation message from the form's submit attempt, if any. */
  error?: string;
  onSave: (details: HandoverDetails) => void;
}

export function HandoverDetailsDialog({
  open,
  onOpenChange,
  method,
  value,
  error,
  onSave,
}: HandoverDetailsDialogProps) {
  const [draft, setDraft] = useState<HandoverDetails>(value);

  // Re-seed on open so cancelling leaves the committed details untouched.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function set<K extends keyof HandoverDetails>(key: K, next: HandoverDetails[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  const inPerson = method === 'IN_PERSON';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{inPerson ? 'Meeting details' : 'Delivery details'}</DialogTitle>
          <DialogDescription>
            {inPerson
              ? 'Where you plan to meet, and when if you have settled on a time.'
              : 'What postage costs. It sits on top of the deal amount.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {inPerson ? (
            <>
              <PlacePicker
                id="deal-meeting-location"
                label="Meeting place"
                precision="exact"
                value={draft.place}
                onChange={(place) => set('place', place)}
                required
                error={error}
                hint="Somewhere public you can both find."
                textFallbackPlaceholder="Melbourne Central, main entrance"
              />
              <div className="space-y-2">
                <Label htmlFor="deal-meeting-at">
                  Date and time{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="deal-meeting-at"
                  type="datetime-local"
                  value={draft.meetingAt}
                  onChange={(event) => set('meetingAt', event.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="deal-delivery-cost">Delivery cost</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id="deal-delivery-cost"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  autoComplete="off"
                  value={draft.deliveryCostDollars}
                  onChange={(event) => set('deliveryCostDollars', event.target.value)}
                  className="pl-7"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={
                    error ? 'deal-delivery-error' : 'deal-delivery-hint'
                  }
                />
              </div>
              {error ? (
                <p id="deal-delivery-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : (
                <p id="deal-delivery-hint" className="text-xs text-muted-foreground">
                  Enter 0 for free delivery.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!isHandoverComplete(method, draft)}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
