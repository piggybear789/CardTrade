'use client';

// components/sales/CashSaleTermsDialog.tsx
// Versioned delivery/in-person terms editor. Buyer-owned provider-resolved delivery
// addresses are private until funds are secured; every saved change clears acceptance.

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
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
import { FALLBACK_MAP_CENTER, type PlaceValue } from '@/lib/location/types';
import { updateCashSaleTerms } from '@/lib/actions/cashSale';
import type { Tables } from '@/lib/supabase/database.types';
import { cashSaleErrorMessage } from './errorCopy';
import type { CashSaleDeliveryAddress } from './types';

/**
 * A valid coordinate pair, or null.
 *
 * Returns the pair rather than a type predicate: a predicate can only narrow ONE
 * parameter, so `lat is number` left `lng` as `number | null` and every call site
 * needed an assertion to compile.
 */
function coordsOf(
  lat: number | null,
  lng: number | null,
): { lat: number; lng: number } | null {
  const valid =
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  return valid ? { lat: lat as number, lng: lng as number } : null;
}

/** Only provider-resolved places may become contractual locations. */
function isResolvedPlace(place: PlaceValue | null): place is PlaceValue {
  return Boolean(
    place &&
      !place.placeId.startsWith('text:') &&
      !place.placeId.startsWith('legacy:') &&
      coordsOf(place.lat, place.lng) !== null,
  );
}

function meetingFromSale(sale: Tables<'cash_sales'>): PlaceValue | null {
  if (!sale.meeting_location?.trim()) return null;
  const coords = coordsOf(sale.meeting_lat, sale.meeting_lng);
  if (!coords) {
    return {
      label: sale.meeting_location,
      placeId: `text:${sale.meeting_location}`,
      lat: FALLBACK_MAP_CENTER.lat,
      lng: FALLBACK_MAP_CENTER.lng,
      precision: 'exact',
    };
  }
  return {
    label: sale.meeting_location,
    placeId: sale.meeting_place_id ?? `legacy:${sale.id}`,
    lat: coords.lat,
    lng: coords.lng,
    precision: 'exact',
  };
}

function deliveryFromSnapshot(
  deliveryAddress: CashSaleDeliveryAddress | null | undefined,
): PlaceValue | null {
  if (!deliveryAddress) return null;
  const coords = coordsOf(deliveryAddress.lat, deliveryAddress.lng);
  if (!coords) return null;
  return {
    label: deliveryAddress.label,
    placeId: deliveryAddress.placeId,
    lat: coords.lat,
    lng: coords.lng,
    countryCode: deliveryAddress.countryCode,
    precision: 'exact',
  };
}

type CashSaleRow = Tables<'cash_sales'>;

export interface CashSaleTermsDialogProps {
  sale: CashSaleRow;
  deliveryAddress?: CashSaleDeliveryAddress | null;
  canEditDeliveryAddress: boolean;
  /**
   * Whether the viewer may price postage. The Seller only: they choose the carrier
   * and pay them, so they are the only party who can estimate it. Mirrors
   * `canEditDeliveryAddress`, which is the Buyer only — between them the dialog
   * reads as "the buyer owns where it goes, the seller owns what it costs".
   */
  canEditShippingCost: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialMethod?: 'DELIVERY' | 'IN_PERSON';
  hideTrigger?: boolean;
}

export function CashSaleTermsDialog({
  sale,
  deliveryAddress,
  canEditDeliveryAddress,
  canEditShippingCost,
  open: controlledOpen,
  onOpenChange,
  initialMethod,
  hideTrigger = false,
}: CashSaleTermsDialogProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<'DELIVERY' | 'IN_PERSON'>(
    initialMethod ?? sale.fulfillment_method ?? 'DELIVERY',
  );
  const [shippingCost, setShippingCost] = useState(
    (sale.shipping_cost_cents / 100).toFixed(2),
  );
  const [shippingNotes, setShippingNotes] = useState(sale.shipping_notes ?? '');
  const [deliveryPlace, setDeliveryPlace] = useState<PlaceValue | null>(() =>
    deliveryFromSnapshot(deliveryAddress),
  );
  const [meetingPlace, setMeetingPlace] = useState<PlaceValue | null>(() =>
    meetingFromSale(sale),
  );
  const [meetingAt, setMeetingAt] = useState(
    sale.meeting_at ? sale.meeting_at.slice(0, 16) : '',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod(initialMethod ?? sale.fulfillment_method ?? 'DELIVERY');
  }, [open, initialMethod, sale.fulfillment_method]);

  useEffect(() => {
    if (open) return;
    setMethod(sale.fulfillment_method ?? 'DELIVERY');
    setShippingCost((sale.shipping_cost_cents / 100).toFixed(2));
    setShippingNotes(sale.shipping_notes ?? '');
    setDeliveryPlace(deliveryFromSnapshot(deliveryAddress));
    setMeetingPlace(meetingFromSale(sale));
    setMeetingAt(sale.meeting_at ? sale.meeting_at.slice(0, 16) : '');
  }, [open, sale, deliveryAddress]);

  function submit(event: FormEvent) {
    event.preventDefault();
    // A viewer who may not price postage sends the STORED cents back untouched,
    // rather than a value round-tripped through the dollar string. The server
    // rejects a buyer who changes this figure, so re-deriving it here would risk
    // failing the save over a formatting artefact rather than an actual edit.
    const cents = canEditShippingCost
      ? Math.round(Number.parseFloat(shippingCost || '0') * 100)
      : sale.shipping_cost_cents;
    if (method === 'DELIVERY' && (!Number.isFinite(cents) || cents < 0)) {
      setError('Enter a valid postage amount, or 0 if it is included in the price.');
      return;
    }
    if (method === 'DELIVERY' && canEditDeliveryAddress && !isResolvedPlace(deliveryPlace)) {
      setError(FULFILMENT_FIELD_ERRORS.address);
      return;
    }
    const scheduledAt = meetingAt ? new Date(meetingAt) : null;
    if (
      method === 'IN_PERSON' &&
      (!isResolvedPlace(meetingPlace) || !scheduledAt || !Number.isFinite(scheduledAt.getTime()) ||
        scheduledAt.getTime() <= Date.now())
    ) {
      setError(FULFILMENT_FIELD_ERRORS.meeting);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateCashSaleTerms(sale.id, sale.terms_version, {
        fulfillmentMethod: method,
        shippingCostCents: method === 'DELIVERY' ? cents : 0,
        shippingNotes: method === 'DELIVERY' ? shippingNotes : null,
        deliveryAddress:
          method === 'DELIVERY' && canEditDeliveryAddress && deliveryPlace
            ? {
                label: deliveryPlace.label,
                placeId: deliveryPlace.placeId,
                countryCode: deliveryPlace.countryCode ?? '',
                lat: deliveryPlace.lat,
                lng: deliveryPlace.lng,
              }
            : undefined,
        meetingLocation: method === 'IN_PERSON' ? meetingPlace!.label.trim() : null,
        meetingLat: method === 'IN_PERSON' ? meetingPlace!.lat : null,
        meetingLng: method === 'IN_PERSON' ? meetingPlace!.lng : null,
        meetingPlaceId: method === 'IN_PERSON' ? meetingPlace!.placeId : null,
        meetingAt: method === 'IN_PERSON' ? scheduledAt!.toISOString() : null,
      });
      if (result.ok) {
        toast.success(
          sale.fulfillment_method
            ? 'Handover terms updated. Both parties must accept the new version.'
            : 'Handover terms proposed. Both parties must accept to continue.',
        );
        router.refresh();
        setOpen(false);
      } else {
        // Never guess at a concurrency conflict here. This used to report
        // "Terms changed elsewhere" for every failure, including missing
        // database functions, so members were told to review a version that had
        // not changed while the real cause stayed invisible.
        setError(cashSaleErrorMessage(result));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5">
            <Pencil aria-hidden />
            Edit
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{sale.fulfillment_method ? 'Edit handover terms' : 'Propose handover terms'}</DialogTitle>
            <DialogDescription>
              {sale.fulfillment_method
                ? 'Editing creates a new version, so both parties must accept again.'
                : 'Both parties must accept these terms to proceed.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            {/* Same picker and same fields as the trade room. They used to be a
                `Select` here and a pair of tiles there, with different validation
                behind each — which is how the trade room ended up accepting a
                free-text meeting point and an optional meeting time. */}
            <FulfilmentMethodChoice
              name="sale-method"
              value={method}
              onChange={setMethod}
              disabled={pending}
              legend="Fulfillment method"
            />

            <FulfilmentTermsFields
              idPrefix="sale"
              method={method}
              meetingPlace={meetingPlace}
              onMeetingPlaceChange={setMeetingPlace}
              meetingAt={meetingAt}
              onMeetingAtChange={setMeetingAt}
              deliveryCost={shippingCost}
              onDeliveryCostChange={
                canEditShippingCost ? setShippingCost : undefined
              }
              deliveryNotes={shippingNotes}
              onDeliveryNotesChange={setShippingNotes}
              deliveryCostLabel="Postage on top"
              deliveryCostHint={
                canEditShippingCost
                  ? 'Added to the buyer total. Fee is on item price only.'
                  : ''
              }
              deliveryCostOptional
              deliveryCostReadOnlyNote="only the seller sets postage"
              // The seller receives nothing by post, so only the buyer supplies an
              // address. This is the one place the two flows legitimately differ:
              // a trade posts both ways and asks both traders.
              showDeliveryAddress
              deliveryAddress={deliveryPlace}
              onDeliveryAddressChange={
                canEditDeliveryAddress ? setDeliveryPlace : undefined
              }
              deliveryAddressReadOnlyNote="Only the buyer can set the delivery address."
              error={error}
              disabled={pending}
            />

            {error &&
            error !== FULFILMENT_FIELD_ERRORS.meeting &&
            error !== FULFILMENT_FIELD_ERRORS.address ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? 'Saving…' : sale.fulfillment_method ? 'Save changes' : 'Propose terms'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
