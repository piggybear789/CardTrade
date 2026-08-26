'use client';

// components/fulfilment/DeliveryAddressPanel.tsx
//
// Where the goods are being posted, and whether you are allowed to know yet.
//
// A trade posts in BOTH directions, so this shows two addresses: yours, which you can
// always see and edit until someone ships, and theirs, which appears only once
// collateral is locked. A Cash_Sale posts one way and passes a single address with
// `theirs` left null.
//
// The disclosure rule is enforced by RLS in migration 0057, not here. This component
// renders whatever the server was willing to hand over, and says plainly when that is
// nothing — an empty panel with no explanation reads like a bug, which is how people
// end up pasting their address into the chat thread instead.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Home, Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PlacePicker } from '@/components/location';
import { isResolvedPlace, type DeliveryAddress } from '@/domain/fulfilment';
import type { PlaceValue } from '@/lib/location/types';

/** Map a stored address into the picker's value shape. */
function toPlaceValue(address: DeliveryAddress | null): PlaceValue | null {
  if (!address || address.lat == null || address.lng == null) return null;
  return {
    label: address.label,
    placeId: address.placeId,
    lat: address.lat,
    lng: address.lng,
    countryCode: address.countryCode ?? undefined,
    precision: 'exact',
  };
}

export interface DeliveryAddressPanelProps {
  /** The viewer's own address, or null if they have not set one. */
  mine: DeliveryAddress | null;
  /**
   * The other party's address, or null when it does not exist yet OR the viewer is
   * not yet entitled to read it. {@link theirsPending} distinguishes the two.
   */
  theirs?: DeliveryAddress | null;
  /** Copy explaining why `theirs` is absent. Omit for a one-way contract. */
  theirsPending?: string | null;
  /** Whose address `theirs` is, for labelling. */
  counterpartName?: string | null;
  /** Whether the viewer may still add or replace their own address. */
  editable: boolean;
  /** Saves the viewer's own address. Returns a message on failure. */
  onSave: (address: DeliveryAddress) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function DeliveryAddressPanel({
  mine,
  theirs = null,
  theirsPending = null,
  counterpartName,
  editable,
  onSave,
}: DeliveryAddressPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<PlaceValue | null>(() => toPlaceValue(mine));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPlace(toPlaceValue(mine));
      setError(null);
    }
  }

  function handleSave() {
    // Only a provider-resolved address may be saved. A typed string cannot be
    // posted to with any confidence and cannot be checked against what the other
    // party thought they agreed.
    if (!isResolvedPlace(place)) {
      setError('Select an address from the suggestions.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onSave({
        label: place.label.trim(),
        placeId: place.placeId,
        countryCode: place.countryCode ?? null,
        lat: place.lat,
        lng: place.lng,
      });
      if (result.ok) {
        toast.success('Delivery address saved.');
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.message);
      toast.error(result.message);
    });
  }

  return (
    <div className="space-y-cozy">
      <div className="flex items-start justify-between gap-cozy">
        <div className="min-w-0">
          <p className="flex items-center gap-tight text-body font-medium text-muted-foreground">
            <Home className="size-3.5" aria-hidden />
            Your delivery address
          </p>
          <p className="mt-0.5 break-words text-body">
            {mine?.label ?? (
              <span className="text-muted-foreground">
                Not set — the other party cannot post to you until you add one.
              </span>
            )}
          </p>
        </div>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-tight px-snug font-medium [&_svg]:size-3.5"
            onClick={() => handleOpenChange(true)}
          >
            <Pencil aria-hidden />
            {mine ? 'Change' : 'Add address'}
          </Button>
        ) : null}
      </div>

      {theirs || theirsPending ? (
        <div>
          <p className="text-body font-medium text-muted-foreground">
            {counterpartName ? `${counterpartName}'s delivery address` : 'Their delivery address'}
          </p>
          <p className="mt-0.5 break-words text-body">
            {theirs?.label ?? (
              <span className="text-muted-foreground">{theirsPending}</span>
            )}
          </p>
        </div>
      ) : null}

      <p className="text-body text-muted-foreground">
        Addresses are stored separately from the contract and are never shown on a
        map or in chat. Only the person posting to you can see yours, and only once
        collateral is locked.
      </p>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{mine ? 'Change delivery address' : 'Add delivery address'}</DialogTitle>
            <DialogDescription>
              Where should the other party post your goods? Shared with them only
              once collateral is locked on both sides.
            </DialogDescription>
          </DialogHeader>

          <PlacePicker
            id="fulfilment-delivery-address"
            label="Delivery address"
            precision="exact"
            value={place}
            onChange={setPlace}
            required
            showMap={false}
            placeholder="Search your delivery address"
            error={error ?? undefined}
            hint="Choose a suggestion so the address can be confirmed."
            textFallbackPlaceholder="Search your delivery address"
          />

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Saving…' : 'Save address'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
