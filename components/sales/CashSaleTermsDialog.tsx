'use client';

// components/sales/CashSaleTermsDialog.tsx
// Versioned delivery/in-person terms editor. Saving invalidates both acceptances.

import { useEffect, useState, useTransition, type FormEvent } from 'react';
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
import type { PlaceValue } from '@/lib/location/types';
import { updateCashSaleTerms } from '@/lib/actions/cashSale';
import type { Tables } from '@/lib/supabase/database.types';

function placeFromSale(sale: Tables<'cash_sales'>): PlaceValue | null {
  if (!sale.meeting_location?.trim()) return null;
  return {
    label: sale.meeting_location,
    placeId: sale.meeting_place_id ?? `sale:${sale.id}`,
    lat: sale.meeting_lat ?? -37.8136,
    lng: sale.meeting_lng ?? 144.9631,
    precision: 'exact',
  };
}

type CashSaleRow = Tables<'cash_sales'>;

export interface CashSaleTermsDialogProps {
  sale: CashSaleRow;
  /** Controlled open state, used when the fulfillment selector opens the dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Pre-select a method (the selector picked it before details existed). */
  initialMethod?: 'DELIVERY' | 'IN_PERSON';
  /** Hide the built-in trigger when the parent owns the affordance. */
  hideTrigger?: boolean;
}

export function CashSaleTermsDialog({
  sale,
  open: controlledOpen,
  onOpenChange,
  initialMethod,
  hideTrigger = false,
}: CashSaleTermsDialogProps) {
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
  const [address, setAddress] = useState(sale.delivery_address ?? '');
  const [meetingPlace, setMeetingPlace] = useState<PlaceValue | null>(() =>
    placeFromSale(sale),
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
    setAddress(sale.delivery_address ?? '');
    setMeetingPlace(placeFromSale(sale));
    setMeetingAt(sale.meeting_at ? sale.meeting_at.slice(0, 16) : '');
  }, [open, sale]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number.parseFloat(shippingCost || '0') * 100);
    if (method === 'DELIVERY' && (!address.trim() || !Number.isFinite(cents) || cents < 0)) {
      setError('Add the delivery address and a valid shipping cost.');
      return;
    }
    if (method === 'IN_PERSON' && !meetingPlace?.label.trim()) {
      setError('Add the meeting location.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateCashSaleTerms(sale.id, sale.terms_version, {
        fulfillmentMethod: method,
        shippingCostCents: method === 'DELIVERY' ? cents : 0,
        shippingNotes: method === 'DELIVERY' ? shippingNotes : null,
        deliveryAddress: method === 'DELIVERY' ? address : null,
        meetingLocation:
          method === 'IN_PERSON' ? meetingPlace!.label.trim() : null,
        meetingLat: method === 'IN_PERSON' ? meetingPlace!.lat : null,
        meetingLng: method === 'IN_PERSON' ? meetingPlace!.lng : null,
        meetingPlaceId: method === 'IN_PERSON' ? meetingPlace!.placeId : null,
        meetingAt:
          method === 'IN_PERSON' && meetingAt
            ? new Date(meetingAt).toISOString()
            : null,
      });
      if (result.ok) {
        toast.success(
          sale.fulfillment_method
            ? 'Handover terms updated. Both parties must accept the new version.'
            : 'Handover terms proposed. Both parties must accept before Stripe collects payment.',
        );
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5"
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {sale.fulfillment_method ? 'Edit handover terms' : 'Propose handover terms'}
            </DialogTitle>
            <DialogDescription>
              Add the details both parties will review. Saving creates a proposal that
              both parties must accept before payment begins through Stripe.
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
                <div className="space-y-2">
                  <Label htmlFor="sale-address">Buyer delivery address</Label>
                  <Textarea
                    id="sale-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Name, street, suburb, state and postcode"
                    maxLength={1000}
                    rows={3}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Private to the buyer and seller. It is never shown on the listing.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sale-shipping-cost">Shipping cost (AUD)</Label>
                  <Input
                    id="sale-shipping-cost"
                    inputMode="decimal"
                    value={shippingCost}
                    onChange={(event) => setShippingCost(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sale-shipping-notes">Shipping details</Label>
                  <Textarea
                    id="sale-shipping-notes"
                    value={shippingNotes}
                    onChange={(event) => setShippingNotes(event.target.value)}
                    placeholder="Insurance, signature, packaging or carrier preference"
                  />
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
                  hint="Pick a public spot both parties can find."
                  textFallbackPlaceholder="A public, agreed meeting point"
                />
                <div className="space-y-2">
                  <Label htmlFor="sale-meeting-at">Meeting time</Label>
                  <Input
                    id="sale-meeting-at"
                    type="datetime-local"
                    value={meetingAt}
                    onChange={(event) => setMeetingAt(event.target.value)}
                  />
                </div>
              </>
            )}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending
                ? 'Saving…'
                : sale.fulfillment_method
                  ? 'Save changes'
                  : 'Propose terms'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
