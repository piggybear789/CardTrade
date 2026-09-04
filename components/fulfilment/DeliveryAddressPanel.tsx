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

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, ChevronRightIcon, InfoIcon, LoaderCircleIcon, TruckIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

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

/** A party at one end of a lane. The destination end is the emphasised one. */
function Endpoint({
  children,
  destination = false,
}: {
  children: ReactNode;
  destination?: boolean;
}) {
  return (
    <span
      className={cn(
        // Badge's own geometry — `rounded-md`, `px-2.5 py-0.5`, `text-meta
        // font-medium` — rather than a second pill shape. Not the component
        // itself, because an endpoint needs to truncate a long display name and
        // Badge has no width story; but it must not look like a different kind
        // of chip from the status badge two rows above it.
        'max-w-[8rem] shrink-0 truncate rounded-md border px-2.5 py-0.5 text-meta font-medium',
        // The destination goes SOLID. Two grey chips either end of a grey line
        // made the direction something you worked out from the arrowhead; a
        // filled end and a hollow one says which way this parcel travels before
        // you have read either name.
        destination
          ? 'border-obsidian bg-obsidian text-mist'
          : 'border-border bg-card text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/**
 * One direction of travel: who posts, to whom, and whether that end has an
 * address yet.
 *
 * THE DIAGRAM IS THE POINT. This was two stacked labels — "Your delivery
 * address" and "{name}'s delivery address" — and the label was actively
 * misleading: "your" address is the one THEY post to, so a reader looking for
 * "where do I send it" found their own street first. An arrow from a sender to
 * a recipient says which is which without a sentence, and a trade posting in
 * both directions is then obviously two of them.
 */
function Lane({
  from,
  to,
  status,
  ready,
  parcel,
  detail,
  action,
}: {
  from: string;
  to: string;
  /** Two or three words on the right of the route: "Ready", "Waiting on Sam". */
  status: string;
  ready: boolean;
  /**
   * What is travelling this way.
   *
   * The lanes used to carry only addresses, which meant a two-way swap showed two
   * routes and two streets and never once named a card — the reader had to hold
   * "the Vaporeon is the one coming to me" in their head while reading a postcode.
   */
  parcel?: ReactNode;
  /** The address itself, or why there isn't one. */
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    // The lane awaiting the viewer gets a darker edge. Two identically bordered
    // boxes gave equal billing to the one that needs them and the one that does
    // not; the weight difference does the sorting before any of it is read.
    <li
      className={cn(
        'rounded-lg border p-cozy',
        !ready && action ? 'border-obsidian/30' : 'border-border',
      )}
    >
      {/* Route, state and control on one row; the address itself gets the row
          below, where it has the width to not wrap mid-street. */}
      <div className="flex items-center gap-cozy">
        {/* The route reads as a picture. The same fact is spelled out below for
            assistive tech, where an arrow made of borders is nothing. */}
        <span className="flex min-w-0 flex-1 items-center gap-snug" aria-hidden>
          <Endpoint>{from}</Endpoint>
          <span className="relative flex h-4 min-w-10 flex-1 items-center">
            <span className="h-px w-full bg-border" />
            {/* The padding belongs to the gap in the line, not to the glyph:
                putting it on the SVG shrinks the truck inside its own box. */}
            <span className="absolute left-1/2 -translate-x-1/2 bg-card px-1.5">
              <HugeiconsIcon icon={TruckIcon} className="size-4 text-muted-foreground" />
            </span>
            <HugeiconsIcon icon={ChevronRightIcon} className="absolute right-0 size-3.5 -translate-y-px text-muted-foreground" />
          </span>
          <Endpoint destination>{to}</Endpoint>
        </span>
        <span className="sr-only">{`${from} posts to ${to}.`}</span>

        {/* A chip, not loose text. The status is a verdict on the lane — ready,
            or someone is being waited on — and next to a route diagram it needs
            an edge or it reads as a caption on the arrow. */}
        <span
          className={cn(
            'flex shrink-0 items-center gap-tight rounded-md border px-2.5 py-0.5 text-meta font-medium',
            // The one that needs the viewer carries the accent, so a glance at
            // the two lanes lands on the one they can do something about.
            ready
              ? 'cardtrade-success-chip'
              : action
                ? 'noditto-character'
                : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {ready ? <HugeiconsIcon icon={CheckIcon} className="size-3" aria-hidden /> : null}
          {status}
        </span>
      </div>

      {/* Facts left, control right, on one baseline. The button was a third
          stacked block under the address, which made every lane three rows tall
          and pushed the second lane most of a screen down. Beside the text it
          costs no height, and it lands in the column the eye is already using
          for this lane's verdict — the status chip sits directly above it. */}
      <div className="mt-snug flex items-end justify-between gap-cozy">
        <div className="min-w-0 flex-1">
          {parcel ? (
            <p className="min-w-0 break-words text-body font-semibold">{parcel}</p>
          ) : null}
          <p
            className={cn(
              'min-w-0 break-words text-body',
              parcel ? 'mt-0.5' : null,
              ready ? null : 'text-muted-foreground',
            )}
          >
            {detail}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </li>
  );
}

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
  /** What is being posted TO the viewer, named on that lane. */
  mineParcel?: ReactNode;
  /** What the viewer is posting to the counterparty. */
  theirsParcel?: ReactNode;
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
  mineParcel,
  theirsParcel,
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
        
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.message);
      toast.error(result.message);
    });
  }

  const them = counterpartName?.trim() || 'They';
  const twoWay = Boolean(theirs || theirsPending);

  return (
    <div className="space-y-snug">
      <ul className="space-y-snug">
        <Lane
          from={them}
          to="You"
          ready={Boolean(mine)}
          status={mine ? 'Ready' : 'Your move'}
          parcel={mineParcel}
          detail={mine?.label ?? 'No address yet.'}
          action={
            editable ? (
              // SOLID while the address is missing, outline once it exists.
              // "Add address" is the only thing standing between this trade and
              // a parcel, so it carries the weight; "Change" is maintenance on a
              // lane that is already done and must not compete with the lane
              // that is not.
              <Button
                type="button"
                variant={mine ? 'outline' : 'default'}
                size="sm"
                className={cn(
                  'shrink-0 gap-tight px-snug font-medium [&_svg]:size-3.5',
                  mine
                    ? null
                    : 'bg-obsidian text-mist hover:bg-obsidian/90 focus-visible:ring-obsidian',
                )}
                onClick={() => handleOpenChange(true)}
              >
                {mine ? 'Change' : 'Add address'}
              </Button>
            ) : undefined
          }
        />

        {twoWay ? (
          <Lane
            from="You"
            to={them}
            ready={Boolean(theirs)}
            status={theirs ? 'Ready' : `Waiting on ${them}`}
            parcel={theirsParcel}
            detail={theirs?.label ?? theirsPending}
          />
        ) : null}
      </ul>

      {/* One sentence, on a surface with an icon. Two sentences of grey text was
          the fourth muted paragraph in the tab and got skipped — and this is the
          one that stops people pasting their street into the chat thread. */}
      <p className="flex items-center gap-snug rounded-md bg-muted px-cozy py-snug text-body text-muted-foreground">
        <HugeiconsIcon icon={InfoIcon} className="size-4 shrink-0" aria-hidden />
        <span>Addresses are never shown in chat, and only to the sender.</span>
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
              {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Saving…' : 'Save address'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
