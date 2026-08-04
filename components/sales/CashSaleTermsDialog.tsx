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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PlacePicker } from '@/components/location';
import { FALLBACK_MAP_CENTER, type PlaceValue } from '@/lib/location/types';
import { updateCashSaleTerms } from '@/lib/actions/cashSale';
import type { Tables } from '@/lib/supabase/database.types';
import type { CashSaleDeliveryAddress } from './types';

function hasCoordinates(lat: number | null, lng: number | null): lat is number {
  return Boolean(
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180,
  );
}

/** Only provider-resolved places may become contractual locations. */
function isResolvedPlace(place: PlaceValue | null): place is PlaceValue {
  return Boolean(
    place &&
      !place.placeId.startsWith('text:') &&
      !place.placeId.startsWith('legacy:') &&
      hasCoordinates(place.lat, place.lng),
  );
}

function meetingFromSale(sale: Tables<'cash_sales'>): PlaceValue | null {
  if (!sale.meeting_location?.trim()) return null;
  if (!hasCoordinates(sale.meeting_lat, sale.meeting_lng)) {
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
    lat: sale.meeting_lat,
    lng: sale.meeting_lng,
    precision: 'exact',
  };
}

function deliveryFromSnapshot(
  deliveryAddress: CashSaleDeliveryAddress | null | undefined,
): PlaceValue | null {
  if (!deliveryAddress || !hasCoordinates(deliveryAddress.lat, deliveryAddress.lng)) return null;
  return {
    label: deliveryAddress.label,
    placeId: deliveryAddress.placeId,
    lat: deliveryAddress.lat,
    lng: deliveryAddress.lng,
    countryCode: deliveryAddress.countryCode,
    precision: 'exact',
  };
}

type CashSaleRow = Tables<'cash_sales'>;

export interface CashSaleTermsDialogProps {
  sale: CashSaleRow;
  deliveryAddress?: CashSaleDeliveryAddress | null;
  canEditDeliveryAddress: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialMethod?: 'DELIVERY' | 'IN_PERSON';
  hideTrigger?: boolean;
}

export function CashSaleTermsDialog({
  sale,
  deliveryAddress,
  canEditDeliveryAddress,
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
    const cents = Math.round(Number.parseFloat(shippingCost || '0') * 100);
    if (method === 'DELIVERY' && (!Number.isFinite(cents) || cents < 0)) {
      setError('Enter a valid shipping cost.');
      return;
    }
    if (method === 'DELIVERY' && canEditDeliveryAddress && !isResolvedPlace(deliveryPlace)) {
      setError('Select a suggested delivery address before saving.');
      return;
    }
    const scheduledAt = meetingAt ? new Date(meetingAt) : null;
    if (
      method === 'IN_PERSON' &&
      (!isResolvedPlace(meetingPlace) || !scheduledAt || !Number.isFinite(scheduledAt.getTime()) ||
        scheduledAt.getTime() <= Date.now())
    ) {
      setError('Choose a suggested public meeting point and a future meeting time.');
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
            : 'Handover terms proposed. Both parties must accept before Stripe collects payment.',
        );
        router.refresh();
        setOpen(false);
      } else {
        setError(result.message ?? 'Terms changed elsewhere. Review and try again.');
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
              Editing creates a new version, so both parties must accept it before Stripe begins collection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="sale-method">Fulfillment method</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as typeof method)}>
                <SelectTrigger id="sale-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DELIVERY">Ship the item</SelectItem>
                  <SelectItem value="IN_PERSON">Meet face to face</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {method === 'DELIVERY' ? (
              <>
                {canEditDeliveryAddress ? (
                  <PlacePicker
                    id="sale-address"
                    label="Delivery address"
                    precision="exact"
                    value={deliveryPlace}
                    onChange={setDeliveryPlace}
                    required
                    showMap={false}
                    placeholder="Search your delivery address"
                    error={
                      error === 'Select a suggested delivery address before saving.'
                        ? error
                        : undefined
                    }
                    hint="Select an address from the suggestions. We never show a map or share it until Stripe has collected payment."
                    textFallbackPlaceholder="Search your delivery address"
                  />
                ) : (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Only the buyer can add or replace the delivery address. It is shared with you once Stripe has collected payment.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="sale-shipping-cost">Shipping cost (AUD)</Label>
                  <Input id="sale-shipping-cost" inputMode="decimal" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sale-shipping-notes">Shipping details</Label>
                  <Textarea id="sale-shipping-notes" value={shippingNotes} onChange={(event) => setShippingNotes(event.target.value)} placeholder="Insurance, signature, packaging or carrier preference" />
                </div>
              </>
            ) : (
              <>
                <PlacePicker
                  id="sale-location"
                  label="Meeting location"
                  precision="exact"
                  value={meetingPlace}
                  onChange={setMeetingPlace}
                  required
                  error={
                    error === 'Choose a suggested public meeting point and a future meeting time.'
                      ? error
                      : undefined
                  }
                  hint="Use a public spot both parties can find. Choose a suggestion to confirm the map pin."
                  textFallbackPlaceholder="A public, agreed meeting point"
                />
                <div className="space-y-2">
                  <Label htmlFor="sale-meeting-at">Meeting time</Label>
                  <Input id="sale-meeting-at" type="datetime-local" value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} required />
                </div>
              </>
            )}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
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
