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
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  /**
   * Copy overrides for the RETURN leg (0088), where the same carrier capture is
   * reached by the Buyer sending goods BACK.
   *
   * Overrides rather than a second component: the carrier list, the "Other" branch
   * and the tracking floor are the parts that matter and duplicating them would let
   * the two drift. Only the words differ, and they must — "Record shipment" on a
   * return would read as if the buyer were sending the wrong parcel.
   */
  title?: string;
  description?: string;
  submitLabel?: string;
}

/** Australian carriers most commonly used for collectibles postage. */
const CARRIERS = [
  { value: 'Australia Post', label: 'Australia Post' },
  { value: 'StarTrack', label: 'StarTrack' },
  { value: 'Sendle', label: 'Sendle' },
  { value: 'Aramex', label: 'Aramex' },
  { value: 'Couriers Please', label: 'Couriers Please' },
  { value: 'DHL', label: 'DHL' },
  { value: 'FedEx', label: 'FedEx' },
  { value: 'TNT', label: 'TNT' },
  { value: 'UPS', label: 'UPS' },
  { value: 'Other', label: 'Other' },
] as const;

/** Tracking numbers vary wildly; two characters is the only safe floor. */
const TRACKING_MIN = 2;

export function RecordShipmentDialog({
  open,
  onOpenChange,
  onSubmit,
  pending = false,
  recipientName,
  recipientAddressKnown = true,
  title,
  description,
  submitLabel,
}: RecordShipmentDialogProps) {
  const [carrier, setCarrier] = useState('');
  const [customCarrier, setCustomCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  // Reset on close so a cancelled attempt does not prefill the next one.
  useEffect(() => {
    if (open) return;
    setCarrier('');
    setCustomCarrier('');
    setTrackingNumber('');
  }, [open]);

  const resolvedCarrier = carrier === 'Other' ? customCarrier.trim() : carrier;
  const canSubmit =
    resolvedCarrier !== '' && trackingNumber.trim().length >= TRACKING_MIN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? 'Record shipment'}</DialogTitle>
          <DialogDescription>
            {description ?? (
              <>
                Add tracking for what you are sending
                {recipientName ? ` to ${recipientName}` : ''}.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!recipientAddressKnown ? (
          <p
            role="alert"
            className="rounded-md border border-dashed border-iris/40 bg-iris/10 px-cozy py-snug text-body"
          >
            You do not have a delivery address for this contract yet. Ask the other
            party to add theirs before you post anything.
          </p>
        ) : null}

        {/* Stacked, not a three-column row: "Couriers Please" and a tracking
            number do not fit side by side, and choosing Other used to add a
            third field that broke the row and orphaned tracking below it. */}
        <div className="space-y-group">
          <div className="space-y-snug">
            <Label htmlFor="ship-carrier">Carrier</Label>
            <Select value={carrier} onValueChange={setCarrier} disabled={pending}>
              <SelectTrigger id="ship-carrier">
                <SelectValue placeholder="Select carrier" />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {carrier === 'Other' ? (
            <div className="space-y-snug">
              <Label htmlFor="ship-carrier-custom">Carrier name</Label>
              <Input
                id="ship-carrier-custom"
                value={customCarrier}
                onChange={(event) => setCustomCarrier(event.target.value)}
                placeholder="Who is carrying it"
                autoComplete="off"
                disabled={pending}
                required
              />
            </div>
          ) : null}

          <div className="space-y-snug">
            <Label htmlFor="ship-tracking">Tracking number</Label>
            <Input
              id="ship-tracking"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              placeholder="As printed on the receipt"
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
                carrier: resolvedCarrier,
                trackingNumber: trackingNumber.trim(),
              })
            }
          >
            {pending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
            {pending ? 'Saving…' : (submitLabel ?? 'Record')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
