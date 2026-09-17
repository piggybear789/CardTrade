'use client';

// components/fulfilment/CarrierField.tsx
//
// PICK A CARRIER, OR NAME ONE. The control both places that capture a shipment use:
// `RecordShipmentDialog` (the trade room and the cash-sale return leg) and the cash-sale
// Status tab.
//
// A SELECT AND NOT A TEXT FIELD, and that is a correctness decision rather than a
// convenience. `tracking_carrier` is free text, and everything downstream matches on it:
// `carrierTrackingUrl` decides whether the buyer gets a Track link, and
// `ship24CourierCode` decides whether the parcel is registered for polling — and a
// carrier-confirmed delivery is the ONLY thing that starts the inspection clock. A typo
// ("Aus Post", "auspost.") silently costs both, with no error anywhere: the sale simply
// stops moving on its own. Picking from the list makes the stored string one the lookups
// recognise.
//
// The `Other` branch stays, because a seller whose courier is not listed still has to be
// able to record a parcel that is already in the post. It is honest about the cost.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CARRIER_OPTIONS, OTHER_CARRIER } from '@/domain/services/tracking/carriers';

export interface CarrierFieldProps {
  /** The picked option — a carrier label, or `Other`. */
  carrier: string;
  onCarrierChange: (carrier: string) => void;
  /** The typed name, used only while `carrier` is `Other`. */
  customCarrier: string;
  onCustomCarrierChange: (name: string) => void;
  /** Unique per instance: two of these can be on one page. */
  idPrefix: string;
  disabled?: boolean;
}

/**
 * Resolve what should be persisted from the pair of values.
 *
 * Exported so callers derive the stored carrier the same way rather than each writing
 * their own ternary — the whole point of the select is that the stored string is
 * predictable.
 */
export function resolveCarrier(carrier: string, customCarrier: string): string {
  return carrier === OTHER_CARRIER ? customCarrier.trim() : carrier;
}

export function CarrierField({
  carrier,
  onCarrierChange,
  customCarrier,
  onCustomCarrierChange,
  idPrefix,
  disabled = false,
}: CarrierFieldProps) {
  const other = carrier === OTHER_CARRIER;

  return (
    <>
      <div className="space-y-snug">
        <Label htmlFor={`${idPrefix}-carrier`}>Carrier</Label>
        <Select value={carrier} onValueChange={onCarrierChange} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-carrier`}>
            <SelectValue placeholder="Select carrier" />
          </SelectTrigger>
          <SelectContent>
            {CARRIER_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {other ? (
        <div className="space-y-snug">
          <Label htmlFor={`${idPrefix}-carrier-custom`}>Carrier name</Label>
          <Input
            id={`${idPrefix}-carrier-custom`}
            value={customCarrier}
            onChange={(event) => onCustomCarrierChange(event.target.value)}
            placeholder="Who is carrying it"
            autoComplete="off"
            disabled={disabled}
            required
          />
          {/* SAYS WHAT IT COSTS. An unlisted carrier cannot be polled, and the
              inspection clock only starts on a carrier-confirmed delivery — so the
              buyer confirms receipt by hand instead. Better stated here than
              discovered by a seller wondering why nothing advanced. */}
          <p className="text-meta text-muted-foreground">
            We cannot follow this one automatically, so the buyer confirms arrival
            themselves.
          </p>
        </div>
      ) : null}
    </>
  );
}
