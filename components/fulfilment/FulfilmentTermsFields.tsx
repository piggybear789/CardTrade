'use client';

// components/fulfilment/FulfilmentTermsFields.tsx
//
// The method-specific half of a fulfilment terms form, shared by the Cash_Sale and
// 2-way Trade rooms: a meeting place and time for IN_PERSON, a postage price and
// notes for DELIVERY, plus the private postal address when the viewer is the one
// receiving goods.
//
// Extracted because the two rooms had drifted, and not cosmetically. The cash sale
// required a provider-resolved meeting place and a future time; the trade accepted
// free text with a fallback map centre and made the time optional. That gap is what
// left a face-to-face trade with no instant to measure an inspection window from.
// One component means one standard.
//
// Presentational: it owns no server action. Each room passes state in and gets
// changes out, then saves through its own action.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import { PlacePicker } from '@/components/location';
import type { PlaceValue } from '@/lib/location/types';
import type { FulfilmentMethod } from '@/domain/fulfilment';

/** Everything the fields render and report. */
export interface FulfilmentTermsFieldsProps {
  /** Prefix for field ids, so two forms on one page do not collide. */
  idPrefix: string;
  method: FulfilmentMethod | null;

  // --- IN_PERSON ---
  meetingPlace: PlaceValue | null;
  onMeetingPlaceChange: (place: PlaceValue | null) => void;
  /** `datetime-local` value, i.e. `YYYY-MM-DDTHH:mm`. */
  meetingAt: string;
  onMeetingAtChange: (value: string) => void;

  // --- DELIVERY ---
  /** Dollar string, so a half-typed amount is not destroyed by rounding. */
  deliveryCost: string;
  /**
   * Omit to render the postage figure read-only, with
   * {@link deliveryCostReadOnlyNote} in place of the input.
   *
   * A Cash_Sale omits it for the Buyer: the Seller picks the carrier and pays
   * them, so only they can price it. A Trade passes it for both traders, who each
   * post and therefore each have a say.
   */
  onDeliveryCostChange?: (value: string) => void;
  deliveryNotes: string;
  onDeliveryNotesChange: (value: string) => void;
  notesMaxLength?: number;
  /** Label for the postage field. Trades split it; a sale passes it on. */
  deliveryCostLabel?: string;
  deliveryCostHint?: string;
  /**
   * Drops the required marker. Postage defaults to 0, so on a Cash_Sale leaving it
   * alone is a real choice — the Seller has priced postage into the item — rather
   * than an unanswered question.
   */
  deliveryCostOptional?: boolean;
  /** Shown instead of the input when the viewer may not price postage. */
  deliveryCostReadOnlyNote?: string;

  // --- The viewer's own postal address, when they receive goods by post ---
  /**
   * Whether to show the address picker. False for a Cash_Sale Seller, who receives
   * nothing by post; true for the Buyer and for BOTH traders on a trade.
   */
  showDeliveryAddress?: boolean;
  deliveryAddress?: PlaceValue | null;
  onDeliveryAddressChange?: (place: PlaceValue | null) => void;
  /** Shown instead of the picker when the viewer may not edit the address. */
  deliveryAddressReadOnlyNote?: string;

  /** Field-level error, matched by the messages this component itself emits. */
  error?: string | null;
  disabled?: boolean;
}

/** The two messages this component highlights inline on its own fields. */
export const FULFILMENT_FIELD_ERRORS = {
  meeting: 'Choose a suggested meeting point and a future meeting time.',
  address: 'Select a suggested delivery address before saving.',
} as const;

export function FulfilmentTermsFields({
  idPrefix,
  method,
  meetingPlace,
  onMeetingPlaceChange,
  meetingAt,
  onMeetingAtChange,
  deliveryCost,
  onDeliveryCostChange,
  deliveryNotes,
  onDeliveryNotesChange,
  notesMaxLength = 2000,
  deliveryCostLabel = 'Delivery cost',
  deliveryCostHint = 'Enter 0 for free delivery. Tracking is added when you record a shipment.',
  deliveryCostOptional = false,
  deliveryCostReadOnlyNote,
  showDeliveryAddress = false,
  deliveryAddress = null,
  onDeliveryAddressChange,
  deliveryAddressReadOnlyNote,
  error = null,
  disabled = false,
}: FulfilmentTermsFieldsProps) {
  if (method === 'IN_PERSON') {
    return (
      <>
        <PlacePicker
          id={`${idPrefix}-meeting-place`}
          label="Meeting place"
          precision="exact"
          value={meetingPlace}
          onChange={onMeetingPlaceChange}
          required
          // Same domain rule as the delivery address: `text:` is refused. The map pin
          // is the error-prevention this field exists for — two suburbs share a name
          // often enough that a free-text "Richmond" confirms nothing — so an
          // unresolved value is not a lesser answer, it is not an answer.
          requireResolved
          error={error === FULFILMENT_FIELD_ERRORS.meeting ? error : undefined}
          hint="Somewhere public you can both find. Choose a suggestion to confirm the map pin."
          textFallbackPlaceholder="A public, agreed meeting point"
        />
        <div className="space-y-snug">
          {/* No longer optional. The inspection window of a face-to-face exchange
              is measured from this instant, so a trade without one has no clock and
              its collateral races the card authorisation with nothing to stop it. */}
          <Label htmlFor={`${idPrefix}-meeting-at`}>Date and time</Label>
          <Input
            id={`${idPrefix}-meeting-at`}
            type="datetime-local"
            value={meetingAt}
            onChange={(event) => onMeetingAtChange(event.target.value)}
            disabled={disabled}
            required
          />
          <p className="text-body text-muted-foreground">
            Both of you get 72 hours after this time to check what you received before
            the contract settles on its own.
          </p>
        </div>
      </>
    );
  }

  if (method === 'DELIVERY') {
    return (
      <>
        {showDeliveryAddress ? (
          onDeliveryAddressChange ? (
            <PlacePicker
              id={`${idPrefix}-address`}
              label="Your delivery address"
              precision="exact"
              value={deliveryAddress}
              onChange={onDeliveryAddressChange}
              required
              // `domain/fulfilment/terms.ts` refuses a `text:` id here, so without
              // this the no-key fallback offered a field whose every value was
              // certain to be rejected on save.
              requireResolved
              showMap={false}
              placeholder="Search your delivery address"
              error={error === FULFILMENT_FIELD_ERRORS.address ? error : undefined}
              hint="Shared with the seller only after payment."
              textFallbackPlaceholder="Search your delivery address"
            />
          ) : (
            <p className="rounded-md border bg-muted/30 px-cozy py-snug text-body text-muted-foreground">
              {deliveryAddressReadOnlyNote ??
                'Only the recipient can add or replace the delivery address.'}
            </p>
          )
        ) : null}

        <div className="space-y-snug">
          <Label htmlFor={`${idPrefix}-delivery-cost`}>
            {deliveryCostLabel}
            {deliveryCostOptional ? (
              <span className="font-normal text-muted-foreground"> (optional)</span>
            ) : (
              <span className="text-destructive" aria-hidden>
                {' '}
                *
              </span>
            )}
          </Label>
          {onDeliveryCostChange ? (
            <MoneyInput
              id={`${idPrefix}-delivery-cost`}
              value={deliveryCost}
              onChange={(event) => onDeliveryCostChange(event.target.value)}
              disabled={disabled}
              required={!deliveryCostOptional}
            />
          ) : (
            // Read-only: show the figure that has been proposed, not an empty
            // note. The viewer still has to accept this number, so hiding it
            // would ask them to agree to a total they cannot see broken down.
            <p className="rounded-md border bg-muted/30 px-cozy py-snug text-body">
              <span className="font-medium tabular-nums">
                ${Number.parseFloat(deliveryCost || '0').toFixed(2)}
              </span>
              {deliveryCostReadOnlyNote ? (
                <span className="text-muted-foreground">
                  {' '}
                  — {deliveryCostReadOnlyNote}
                </span>
              ) : null}
            </p>
          )}
          <p className="text-body text-muted-foreground">{deliveryCostHint}</p>
        </div>

        <div className="space-y-snug">
          <Label htmlFor={`${idPrefix}-delivery-notes`}>
            Shipping notes{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={`${idPrefix}-delivery-notes`}
            value={deliveryNotes}
            onChange={(event) => onDeliveryNotesChange(event.target.value)}
            placeholder="Who ships first, preferred carrier, packing notes…"
            maxLength={notesMaxLength}
            rows={3}
            disabled={disabled}
          />
        </div>
      </>
    );
  }

  return null;
}
