'use client';

// components/trade/TradeHandoverTermsEditor.tsx
//
// Agree face-to-face / postage details on a live trade until either side ships.
//
// The method choice and the method-specific fields now come from
// `components/fulfilment`, shared with the Cash_Sale room. That is not tidying: the
// two had genuinely drifted. This editor used to accept a free-text meeting point
// with a fallback map centre and treat the meeting time as optional, where the cash
// sale demanded a provider-resolved place and a future time. The optional time is
// what left a face-to-face trade with no instant to measure an inspection window
// from, so it is now required.
//
// The postal ADDRESS is deliberately not here. It is private to each trader rather
// than a negotiated term, so it lives in its own panel and its own action.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  FULFILMENT_FIELD_ERRORS,
  FulfilmentMethodChoice,
  FulfilmentTermsFields,
} from '@/components/fulfilment';
import { updateTradeHandoverTerms } from '@/lib/actions/trades';
import { deliveryNotesFromDetails } from '@/lib/handover/terms';
import { isResolvedPlace, type FulfilmentMethod } from '@/domain/fulfilment';
import { DEAL_DELIVERY_COST_MAX, DEAL_TEXT_MAX } from '@/lib/marketplace-constants';
import { FALLBACK_MAP_CENTER, type PlaceValue } from '@/lib/location/types';
import type { TradeRow } from '@/lib/realtime/useTradeRealtime';

/** Messages for the typed errors `updateTradeHandoverTerms` can return. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to continue.',
  'not-participant': 'You are not a participant in this trade.',
  'invalid-state': 'Terms are locked once either trader has shipped.',
  'invalid-handover': 'Choose how the goods change hands.',
  'invalid-delivery-cost': 'Enter a valid postage amount.',
  'missing-meeting-location': FULFILMENT_FIELD_ERRORS.meeting,
  'missing-meeting-time': FULFILMENT_FIELD_ERRORS.meeting,
  'persistence-error': 'Could not save the terms. Please try again.',
};

/** The stored meeting point as a picker value, preserving unresolved legacy rows. */
function placeFromTrade(trade: TradeRow): PlaceValue | null {
  const label = trade.meeting_location?.trim();
  if (!label) return null;
  const hasCoords =
    typeof trade.meeting_lat === 'number' && typeof trade.meeting_lng === 'number';
  return {
    label,
    // A legacy row with no provider id must not masquerade as resolved: the
    // `text:` prefix is what `isResolvedPlace` keys on to refuse it.
    placeId: trade.meeting_place_id ?? `text:${label}`,
    lat: hasCoords ? (trade.meeting_lat as number) : FALLBACK_MAP_CENTER.lat,
    lng: hasCoords ? (trade.meeting_lng as number) : FALLBACK_MAP_CENTER.lng,
    precision: 'exact',
  };
}

/** ISO instant to a `datetime-local` value in the viewer's own timezone. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Integer cents to an editable dollar string. */
function centsToDollars(cents: number | null): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

/** Dollar string to integer cents, or null when it is not a usable amount. */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export interface TradeHandoverTermsEditorProps {
  trade: TradeRow;
  /** Button label when terms are not yet set. */
  triggerLabel?: string;
}

export function TradeHandoverTermsEditor({
  trade,
  triggerLabel = 'Edit terms',
}: TradeHandoverTermsEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [method, setMethod] = useState<FulfilmentMethod | null>(trade.handover_method);
  const [meetingPlace, setMeetingPlace] = useState<PlaceValue | null>(() =>
    placeFromTrade(trade),
  );
  const [meetingAt, setMeetingAt] = useState(toLocalInputValue(trade.meeting_at));
  const [deliveryCost, setDeliveryCost] = useState(
    centsToDollars(trade.delivery_cost_cents),
  );
  const [deliveryNotes, setDeliveryNotes] = useState(
    deliveryNotesFromDetails(trade.delivery_details),
  );

  const deliveryCents = dollarsToCents(deliveryCost);
  const meetingInstant = meetingAt ? new Date(meetingAt) : null;

  // Mirrors the server-side validator so the button is not offered for terms that
  // will be refused. The server remains the authority.
  const detailsComplete =
    method === 'IN_PERSON'
      ? isResolvedPlace(meetingPlace) &&
        meetingInstant !== null &&
        Number.isFinite(meetingInstant.getTime()) &&
        meetingInstant.getTime() > Date.now()
      : method === 'DELIVERY'
        ? deliveryCents !== null && deliveryCents <= DEAL_DELIVERY_COST_MAX
        : false;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setMethod(trade.handover_method);
      setMeetingPlace(placeFromTrade(trade));
      setMeetingAt(toLocalInputValue(trade.meeting_at));
      setDeliveryCost(centsToDollars(trade.delivery_cost_cents));
      setDeliveryNotes(deliveryNotesFromDetails(trade.delivery_details));
      setError(null);
    }
  }

  function handleSave() {
    setError(null);
    if (method === null) {
      setError(ERROR_MESSAGES['invalid-handover']);
      return;
    }
    if (!detailsComplete) {
      setError(
        method === 'IN_PERSON'
          ? FULFILMENT_FIELD_ERRORS.meeting
          : ERROR_MESSAGES['invalid-delivery-cost'],
      );
      return;
    }

    startTransition(async () => {
      const result = await updateTradeHandoverTerms(trade.id, {
        method,
        meetingLocation: method === 'IN_PERSON' ? meetingPlace!.label.trim() : null,
        meetingLat: method === 'IN_PERSON' ? meetingPlace!.lat : null,
        meetingLng: method === 'IN_PERSON' ? meetingPlace!.lng : null,
        meetingPlaceId: method === 'IN_PERSON' ? meetingPlace!.placeId : null,
        meetingAt:
          method === 'IN_PERSON' && meetingInstant
            ? meetingInstant.toISOString()
            : null,
        deliveryCostCents: method === 'DELIVERY' ? deliveryCents : null,
        deliveryNotes: method === 'DELIVERY' ? deliveryNotes.trim() || null : null,
      });
      if (result.ok) {
        toast.success('Delivery terms updated.');
        setOpen(false);
        router.refresh();
        return;
      }
      const copy =
        ERROR_MESSAGES[result.error] ?? result.detail ?? 'Could not save the terms.';
      setError(copy);
      toast.error(copy);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5"
        >
          <Pencil aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delivery terms</DialogTitle>
          <DialogDescription>
            Agree how the goods change hands. Either trader can update these until
            someone marks a shipment or confirms a handover.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FulfilmentMethodChoice
            name="trade-room-handover"
            value={method}
            onChange={setMethod}
            disabled={isPending}
          />

          <FulfilmentTermsFields
            idPrefix="trade"
            method={method}
            meetingPlace={meetingPlace}
            onMeetingPlaceChange={setMeetingPlace}
            meetingAt={meetingAt}
            onMeetingAtChange={setMeetingAt}
            deliveryCost={deliveryCost}
            onDeliveryCostChange={setDeliveryCost}
            deliveryNotes={deliveryNotes}
            onDeliveryNotesChange={setDeliveryNotes}
            notesMaxLength={DEAL_TEXT_MAX}
            deliveryCostLabel="Postage each way"
            deliveryCostHint="Enter 0 for free postage. Add each address below, and tracking when you ship."
            error={error}
            disabled={isPending}
          />

          {error &&
          error !== FULFILMENT_FIELD_ERRORS.meeting &&
          error !== FULFILMENT_FIELD_ERRORS.address ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending || !detailsComplete}
            aria-busy={isPending}
            onClick={handleSave}
          >
            {isPending ? 'Saving…' : 'Save terms'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
