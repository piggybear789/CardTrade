'use client';

// components/trade/TradeHandoverTermsEditor.tsx
//
// Agree face-to-face / postage details on a live trade until either side ships.
// Method may already be set on the offer; place, cost, notes and (later) tracking
// are filled in here once both traders are in the room.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MapPin, Pencil, Truck } from 'lucide-react';

import { PlacePicker } from '@/components/location';
import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateTradeHandoverTerms } from '@/lib/actions/trades';
import {
  deliveryNotesFromDetails,
  type HandoverMethod,
} from '@/lib/handover/terms';
import { DEAL_DELIVERY_COST_MAX, DEAL_TEXT_MAX } from '@/lib/marketplace-constants';
import type { PlaceValue } from '@/lib/location/types';
import type { TradeRow } from '@/lib/realtime/useTradeRealtime';

function placeFromTrade(trade: TradeRow): PlaceValue | null {
  if (!trade.meeting_location?.trim()) return null;
  return {
    label: trade.meeting_location,
    placeId: trade.meeting_place_id ?? `trade:${trade.id}`,
    lat: trade.meeting_lat ?? -37.8136,
    lng: trade.meeting_lng ?? 144.9631,
    precision: 'exact',
  };
}

function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  'invalid-state': 'Delivery terms can only be changed before shipping starts.',
  'invalid-handover': 'Choose face to face or delivery, and fill in the details.',
  'invalid-delivery-cost': 'Enter the delivery cost, or 0 for free delivery.',
  'missing-meeting-location': 'Add where you plan to meet.',
  'persistence-error': 'Could not save the terms. Please try again.',
  unauthenticated: 'Sign in again.',
  'not-participant': 'You are not part of this trade.',
};

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

  const [method, setMethod] = useState<HandoverMethod | null>(
    trade.handover_method,
  );
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
  const detailsComplete =
    method === 'IN_PERSON'
      ? Boolean(meetingPlace?.label.trim())
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
    if (method === null || !detailsComplete) {
      setError(ERROR_MESSAGES['invalid-handover']);
      return;
    }
    startTransition(async () => {
      const result = await updateTradeHandoverTerms(trade.id, {
        method,
        meetingLocation:
          method === 'IN_PERSON' ? meetingPlace!.label.trim() : null,
        meetingLat: method === 'IN_PERSON' ? meetingPlace!.lat : null,
        meetingLng: method === 'IN_PERSON' ? meetingPlace!.lng : null,
        meetingPlaceId: method === 'IN_PERSON' ? meetingPlace!.placeId : null,
        meetingAt:
          method === 'IN_PERSON' && meetingAt
            ? new Date(meetingAt).toISOString()
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
          <DialogTitle>Delivery Terms</DialogTitle>
          <DialogDescription>
            Agree how the goods change hands. Either trader can update these until
            someone marks a shipment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Handover</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    value: 'IN_PERSON' as const,
                    label: 'Face to face',
                    hint: 'Meet and swap',
                    icon: MapPin,
                  },
                  {
                    value: 'DELIVERY' as const,
                    label: 'Delivery',
                    hint: 'Post it',
                    icon: Truck,
                  },
                ] as const
              ).map((option) => (
                <ChoiceTile
                  key={option.value}
                  id={`trade-room-handover-${option.value}`}
                  name="trade-room-handover"
                  type="radio"
                  icon={option.icon}
                  label={option.label}
                  hint={option.hint}
                  checked={method === option.value}
                  onChange={() => setMethod(option.value)}
                />
              ))}
            </div>
          </fieldset>

          {method === 'IN_PERSON' ? (
            <>
              <PlacePicker
                id="trade-meeting-location"
                label="Meeting place"
                precision="exact"
                value={meetingPlace}
                onChange={setMeetingPlace}
                required
                error={
                  error === ERROR_MESSAGES['missing-meeting-location']
                    ? error
                    : undefined
                }
                hint="Somewhere public you can both find."
                textFallbackPlaceholder="Melbourne Central, main entrance"
              />
              <div className="space-y-2">
                <Label htmlFor="trade-meeting-at">
                  Date and time{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="trade-meeting-at"
                  type="datetime-local"
                  value={meetingAt}
                  onChange={(event) => setMeetingAt(event.target.value)}
                />
              </div>
            </>
          ) : null}

          {method === 'DELIVERY' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="trade-delivery-cost">
                  Delivery cost
                  <span className="text-destructive" aria-hidden>
                    {' '}
                    *
                  </span>
                </Label>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                    aria-hidden
                  >
                    $
                  </span>
                  <Input
                    id="trade-delivery-cost"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    autoComplete="off"
                    value={deliveryCost}
                    onChange={(event) => setDeliveryCost(event.target.value)}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter 0 for free delivery. Tracking is added when you record a
                  shipment.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trade-delivery-notes">
                  Shipping notes{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="trade-delivery-notes"
                  value={deliveryNotes}
                  onChange={(event) => setDeliveryNotes(event.target.value)}
                  placeholder="Who ships first, preferred carrier, packing notes…"
                  maxLength={DEAL_TEXT_MAX}
                  rows={3}
                />
              </div>
            </>
          ) : null}

          {error ? (
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
