'use client';

// components/fulfilment/SavedAddressField.tsx
//
// The delivery-address field a party fills in when goods reach them by post, backed
// by their PRIVATE saved-address book (0113). It replaces the bare PlacePicker in the
// cash-sale buy flow and the trade delivery step: the party can pick a saved address
// (prefilled to their default) or enter a new one, optionally saving it to the book.
//
// The chosen place is reported upward exactly as the picker did, so the contract keeps
// storing its OWN copy — a saved address is only a SOURCE. Saving to the book is a
// separate, explicit opt-in and never a side effect of committing the contract.
//
// It surfaces the requirement BEFORE commitment: the list loads immediately and the
// picker is always visible, so "you need a delivery address" is stated up front rather
// than arriving as a late save error.

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { listMyAddresses, saveAddress, type SavedAddress } from '@/lib/actions/addresses';
import { PlacePicker, type PlaceValue } from '@/components/location';
import { Button } from '@/components/ui/button';
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

function toPlace(address: SavedAddress): PlaceValue {
  return {
    label: address.addressLabel,
    placeId: address.placeId,
    lat: address.lat ?? Number.NaN,
    lng: address.lng ?? Number.NaN,
    countryCode: address.countryCode,
    precision: 'exact',
  };
}

export interface SavedAddressFieldProps {
  id: string;
  label?: string;
  hint?: string;
  value: PlaceValue | null;
  onChange: (place: PlaceValue | null) => void;
  error?: string;
  disabled?: boolean;
  /**
   * Adopt the member's default saved address when nothing is selected yet.
   *
   * The buy/trade dialogs pass true on a fresh contract so the common case is
   * pre-answered; they pass false once the contract already carries an address so a
   * saved default cannot silently overwrite a deliberate per-contract choice.
   */
  prefillDefault?: boolean;
}

export function SavedAddressField({
  id,
  label = 'Your delivery address',
  hint = 'Shared with the seller only after payment.',
  value,
  onChange,
  error,
  disabled = false,
  prefillDefault = false,
}: SavedAddressFieldProps) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveToBook, setSaveToBook] = useState(false);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listMyAddresses().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAddresses(result.data);
        if (prefillDefault && !value) {
          const preferred = result.data.find((a) => a.isDefault) ?? result.data[0];
          if (preferred) onChange(toPlace(preferred));
        }
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // Load once on mount. `value`/`onChange` are intentionally excluded so a parent
    // re-render cannot re-run the prefill and clobber an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which saved address, if any, the current selection matches. Drives the radio
  // list's checked state and lets "new address" be distinguished from a saved one.
  const selectedId = addresses.find(
    (a) => a.placeId === value?.placeId,
  )?.id;
  const isNewSelection = Boolean(value) && !selectedId;

  function saveEntered() {
    if (!isResolved(value)) return;
    startSaving(async () => {
      const result = await saveAddress({
        place: {
          label: value.label,
          placeId: value.placeId,
          countryCode: value.countryCode ?? null,
          lat: value.lat,
          lng: value.lng,
        },
        isDefault: addresses.length === 0,
      });
      if (!result.ok) {
        toast.error(result.message ?? 'That address could not be saved.');
        return;
      }
      toast.success('Address saved to your account.');
      setSaveToBook(false);
      const refreshed = await listMyAddresses();
      if (refreshed.ok) setAddresses(refreshed.data);
    });
  }

  return (
    <div className="space-y-cozy">
      {loaded && addresses.length > 0 ? (
        <fieldset className="space-y-snug">
          <legend className="text-body font-medium">Choose a saved address</legend>
          <div className="divide-y overflow-hidden rounded-md border bg-card">
            {addresses.map((address) => {
              const inputId = `${id}-saved-${address.id}`;
              return (
                <label
                  key={address.id}
                  htmlFor={inputId}
                  className={cn(
                    'flex cursor-pointer items-start gap-cozy px-cozy py-snug text-body',
                    selectedId === address.id ? 'bg-muted' : 'hover:bg-accent',
                  )}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={`${id}-saved`}
                    className="mt-1 accent-iris"
                    checked={selectedId === address.id}
                    disabled={disabled}
                    onChange={() => onChange(toPlace(address))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {address.label?.trim() || address.addressLabel}
                      {address.isDefault ? (
                        <span className="ml-snug text-meta font-normal text-iris">Default</span>
                      ) : null}
                    </span>
                    {address.label?.trim() ? (
                      <span className="block truncate text-meta text-muted-foreground">
                        {address.addressLabel}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
            <label
              htmlFor={`${id}-saved-new`}
              className={cn(
                'flex cursor-pointer items-center gap-cozy px-cozy py-snug text-body',
                isNewSelection ? 'bg-muted' : 'hover:bg-accent',
              )}
            >
              <input
                id={`${id}-saved-new`}
                type="radio"
                name={`${id}-saved`}
                className="accent-iris"
                checked={isNewSelection}
                disabled={disabled}
                onChange={() => onChange(null)}
              />
              <span className="font-medium">Use a different address</span>
            </label>
          </div>
        </fieldset>
      ) : null}

      {addresses.length === 0 || isNewSelection || !selectedId ? (
        <>
          <PlacePicker
            id={id}
            label={label}
            precision="exact"
            value={value}
            onChange={onChange}
            required
            requireResolved
            showMap={false}
            placeholder="Search your delivery address"
            error={error}
            hint={hint}
            textFallbackPlaceholder="Search your delivery address"
            disabled={disabled}
          />
          {isResolved(value) && !selectedId ? (
            <div className="flex items-center justify-between gap-cozy">
              <div className="flex items-center gap-snug">
                <input
                  id={`${id}-save-to-book`}
                  type="checkbox"
                  className="size-4 accent-iris"
                  checked={saveToBook}
                  onChange={(event) => setSaveToBook(event.target.checked)}
                  disabled={disabled || saving}
                />
                <Label htmlFor={`${id}-save-to-book`} className="font-normal text-muted-foreground">
                  Save this address to my account
                </Label>
              </div>
              {saveToBook ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={saveEntered}
                  disabled={disabled || saving}
                  aria-busy={saving}
                >
                  {saving ? (
                    <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
                  ) : null}
                  Save
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
