'use client';

// components/profile/MemberAddressesEditor.tsx
//
// The member's PRIVATE saved-address book, managed from the Profile tab. A saved
// address is only ever a SOURCE a member copies from into a purchase or trade; it is
// never disclosed to a counterparty. That disclosure lives on the per-contract
// delivery tables and is unchanged here.
//
// Resting state lists the saved addresses (default first) with per-row controls to
// rename the label, make it the default, or remove it. Adding one reuses the same
// PlacePicker the contract flows use, so a stored address is always provider-resolved
// — the server refuses a `text:`/`legacy:` place, matching the contract rule.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  LoaderCircleIcon,
  PlusIcon,
  StarIcon,
  XIcon,
} from '@hugeicons/core-free-icons';

import {
  deleteAddress,
  listMyAddresses,
  saveAddress,
  setDefaultAddress,
  type SavedAddress,
} from '@/lib/actions/addresses';
import { PlacePicker, type PlaceValue } from '@/components/location';
import { SettingsPlaceholder } from '@/components/account/SettingsPrimitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** True for a place the server would accept: resolved, with real coordinates. */
function isResolved(place: PlaceValue | null): place is PlaceValue {
  return Boolean(
    place &&
      !place.placeId.startsWith('text:') &&
      !place.placeId.startsWith('legacy:') &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng),
  );
}

export function MemberAddressesEditor({ onSaved }: { onSaved?: () => void }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listMyAddresses().then((result) => {
      if (cancelled) return;
      if (result.ok) setAddresses(result.data);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refresh() {
    void listMyAddresses().then((result) => {
      if (result.ok) setAddresses(result.data);
    });
    router.refresh();
  }

  if (loadFailed) {
    return (
      <SettingsPlaceholder>
        Your saved addresses are unavailable right now. Reload to try again.
      </SettingsPlaceholder>
    );
  }

  if (addresses === null) {
    return (
      <SettingsPlaceholder>
        <span className="inline-flex items-center gap-snug">
          <HugeiconsIcon icon={LoaderCircleIcon} className="size-4 animate-spin" aria-hidden />
          Loading your saved addresses…
        </span>
      </SettingsPlaceholder>
    );
  }

  return (
    <div className="flex flex-col gap-cozy">
      {addresses.length === 0 && !adding ? (
        <SettingsPlaceholder
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              <HugeiconsIcon icon={PlusIcon} aria-hidden />
              Add an address
            </Button>
          }
        >
          No saved addresses yet.
        </SettingsPlaceholder>
      ) : null}

      {addresses.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card max-md:rounded-none max-md:border-0 max-md:bg-transparent">
          {addresses.map((address) => (
            <SavedAddressRow
              key={address.id}
              address={address}
              onChanged={refresh}
              onSavedLabel={onSaved}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <AddAddressForm
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
            onSaved?.();
          }}
          isFirst={addresses.length === 0}
        />
      ) : addresses.length > 0 ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <HugeiconsIcon icon={PlusIcon} aria-hidden />
            Add another
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SavedAddressRow({
  address,
  onChanged,
  onSavedLabel,
}: {
  address: SavedAddress;
  onChanged: () => void;
  onSavedLabel?: () => void;
}) {
  const [label, setLabel] = useState(address.label ?? '');
  const [pending, startTransition] = useTransition();

  const labelDirty = (address.label ?? '') !== label.trim();

  function saveLabel() {
    if (!labelDirty) return;
    startTransition(async () => {
      const result = await saveAddress({
        id: address.id,
        label: label.trim() || null,
        place: {
          label: address.addressLabel,
          placeId: address.placeId,
          countryCode: address.countryCode,
          lat: address.lat,
          lng: address.lng,
        },
      });
      if (!result.ok) {
        toast.error(result.message ?? 'That address could not be saved.');
        return;
      }
      onChanged();
      onSavedLabel?.();
    });
  }

  function makeDefault() {
    startTransition(async () => {
      const result = await setDefaultAddress(address.id);
      if (!result.ok) {
        toast.error(result.message ?? 'Could not set the default address.');
        return;
      }
      onChanged();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteAddress(address.id);
      if (!result.ok) {
        toast.error(result.message ?? 'Could not remove that address.');
        return;
      }
      onChanged();
    });
  }

  return (
    <li className="flex flex-col gap-snug px-group py-group">
      <div className="flex items-start justify-between gap-cozy">
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-foreground">
            {address.label?.trim() || address.addressLabel}
          </p>
          {address.label?.trim() ? (
            <p className="truncate text-meta text-muted-foreground">{address.addressLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-snug">
          {address.isDefault ? (
            <span className="inline-flex items-center gap-tight text-meta font-medium text-iris">
              <HugeiconsIcon icon={StarIcon} className="size-3.5" aria-hidden />
              Default
            </span>
          ) : (
            <button
              type="button"
              onClick={makeDefault}
              disabled={pending}
              className="text-meta font-medium text-muted-foreground hover:text-foreground disabled:opacity-65"
            >
              Set default
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label="Remove address"
            className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:border-iris disabled:opacity-65"
          >
            <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-snug">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (e.g. Home)"
          maxLength={120}
          disabled={pending}
          aria-label="Address label"
          className="h-9"
        />
        {labelDirty ? (
          <Button type="button" size="sm" onClick={saveLabel} disabled={pending} aria-busy={pending}>
            {pending ? (
              <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
            ) : (
              <HugeiconsIcon icon={CheckIcon} aria-hidden />
            )}
            Save
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function AddAddressForm({
  onCancel,
  onAdded,
  isFirst,
}: {
  onCancel: () => void;
  onAdded: () => void;
  isFirst: boolean;
}) {
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [label, setLabel] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!isResolved(place)) {
      setError('Choose a suggested address so it can be verified before saving.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveAddress({
        label: label.trim() || null,
        place: {
          label: place.label,
          placeId: place.placeId,
          countryCode: place.countryCode ?? null,
          lat: place.lat,
          lng: place.lng,
        },
        // The first saved address becomes the default automatically, so a member
        // who saves one address is not left with a book that has no default to
        // prefill.
        isDefault: isFirst,
      });
      if (!result.ok) {
        setError(result.message ?? 'That address could not be saved.');
        return;
      }
      onAdded();
    });
  }

  return (
    <div className={cn('flex flex-col gap-cozy rounded-xl border bg-card p-group')}>
      <PlacePicker
        id="new-saved-address"
        label="Address"
        precision="exact"
        value={place}
        onChange={setPlace}
        required
        requireResolved
        showMap={false}
        placeholder="Search your address"
        error={error ?? undefined}
        hint="Saved only to your account. Shared with a seller only when you use it for a purchase or trade."
        textFallbackPlaceholder="Search your address"
      />
      <div className="space-y-snug">
        <Label htmlFor="new-saved-address-label">
          Label <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="new-saved-address-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Home"
          maxLength={120}
          disabled={pending}
        />
      </div>
      <div className="flex items-center justify-end gap-cozy">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending} aria-busy={pending}>
          {pending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : null}
          Save address
        </Button>
      </div>
    </div>
  );
}
