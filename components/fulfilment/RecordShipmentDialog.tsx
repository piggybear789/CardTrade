'use client';

// components/fulfilment/RecordShipmentDialog.tsx
//
// Carrier + tracking capture, shared by the Cash_Sale and 2-way Trade rooms.
//
// Both had their own: an inline dialog inside the trade `ActionBar` and a pair of
// bare inputs in `CashSaleView`. The trade one accepted a blank carrier when the
// method was face to face, which is the shape of a form that had been asked to serve
// a flow it did not belong to. Carrier and tracking are now always required, because
// this dialog is only ever reached by a posted contract — a face-to-face exchange
// confirms a handover instead.

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

/** What the caller receives when the form is submitted. */
export interface ShipmentInput {
  carrier: string;
  trackingNumber: string;
}

export interface RecordShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the flow's own server action. Keep the dialog free of action wiring. */
  onSubmit: (shipment: ShipmentInput) => void;
  pending?: boolean;
  /** Who the parcel is going to, for the description line. */
  recipientName?: string | null;
  /**
   * Whether the recipient's postal address is available to the sender yet. When
   * false the dialog says so rather than letting someone post to nowhere.
   */
  recipientAddressKnown?: boolean;
}

/** Tracking numbers vary wildly; two characters is the only safe floor. */
const TRACKING_MIN = 2;

export function RecordShipmentDialog({
  open,
  onOpenChange,
  onSubmit,
  pending = false,
  recipientName,
  recipientAddressKnown = true,
}: RecordShipmentDialogProps) {
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  // Reset on close so a cancelled attempt does not prefill the next one.
  useEffect(() => {
    if (open) return;
    setCarrier('');
    setTrackingNumber('');
  }, [open]);

  const canSubmit =
    carrier.trim() !== '' && trackingNumber.trim().length >= TRACKING_MIN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record shipment</DialogTitle>
          <DialogDescription>
            Add the carrier and tracking number for what you are sending
            {recipientName ? ` to ${recipientName}` : ''}. The carrier confirming
            delivery is what starts the inspection window — your own word does not.
          </DialogDescription>
        </DialogHeader>

        {!recipientAddressKnown ? (
          <p
            role="alert"
            className="rounded-md border border-dashed border-gold/50 bg-gold/10 px-3 py-2 text-sm"
          >
            You do not have a delivery address for this contract yet. Ask the other
            party to add theirs before you post anything.
          </p>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="ship-carrier">
              Carrier
              <span className="text-destructive" aria-hidden>
                {' '}
                *
              </span>
            </Label>
            <Input
              id="ship-carrier"
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              placeholder="e.g. Australia Post"
              autoComplete="off"
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship-tracking">
              Tracking number
              <span className="text-destructive" aria-hidden>
                {' '}
                *
              </span>
            </Label>
            <Input
              id="ship-tracking"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              placeholder="Tracking number"
              autoComplete="off"
              disabled={pending}
              required
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            disabled={pending || !canSubmit}
            aria-busy={pending}
            onClick={() =>
              onSubmit({
                carrier: carrier.trim(),
                trackingNumber: trackingNumber.trim(),
              })
            }
          >
            {pending ? 'Saving…' : 'Record shipment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
