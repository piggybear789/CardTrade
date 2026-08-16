'use client';

// Autocomplete place picker (suburb vs exact). No interactive map SDK — selection
// comes from Google Places Autocomplete suggestions, and the confirmation is a
// Google Maps Embed preview.
//
// The map is here for ERROR PREVENTION, not decoration. Two suburbs share a name
// often enough that a text-only "Selected: Richmond" is not a confirmation of
// anything, and the mistake used to stay invisible until the deal room — by which
// point the terms were set. Showing where the pin landed at selection time is the
// cheapest check available.

import { useEffect, useState } from 'react';

import { readGoogleMapsKey } from '@/lib/location/googleMaps';
import {
  FALLBACK_MAP_CENTER,
  type PlacePrecision,
  type PlaceValue,
} from '@/lib/location/types';
import { PlaceMap } from './PlaceMap';
import { PlaceSearch } from './PlaceSearch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface PlacePickerProps {
  precision: PlacePrecision;
  value: PlaceValue | null;
  onChange: (place: PlaceValue | null) => void;
  label?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  error?: string;
  className?: string;
  textFallbackPlaceholder?: string;
  /** Render the provider map preview. Never enable for a residential address. */
  showMap?: boolean;
  /** Override the precision-derived input placeholder. */
  placeholder?: string;
  /** Restrict results to these ISO 3166-1 alpha-2 countries. Omit for worldwide. */
  countries?: string[];
  /** Rank this country's results first without excluding others. */
  biasCountry?: string | null;
  /**
   * This field's consumer REJECTS an unresolved place.
   *
   * Fulfilment terms do: `domain/fulfilment/terms.ts` refuses a `text:` id for a
   * delivery address or a meeting point, and rightly — a parcel destination or a
   * place to meet a stranger has to be a real location, not a string someone typed.
   *
   * Without this flag the no-key fallback rendered a perfectly fillable input whose
   * every value was guaranteed to be refused on save, with the reason arriving only
   * afterwards as "Select a suggested delivery address before saving." — advice that
   * cannot be followed, because there are no suggestions to select. Set it and the
   * fallback explains the situation instead of inviting work that cannot succeed.
   *
   * Leave it off for a field that accepts free text, such as a listing's `Based
   * near`, which stores whatever was typed.
   */
  requireResolved?: boolean;
}

/**
 * True for a place produced by the no-API-key free-text fallback.
 *
 * Those carry `FALLBACK_MAP_CENTER` coordinates rather than resolved ones, so a map
 * would confidently render the wrong location. Never show a pin for them.
 */
function isUnresolved(place: PlaceValue): boolean {
  return place.placeId.startsWith('text:');
}

export function PlacePicker({
  precision,
  value,
  onChange,
  label = 'Location',
  hint,
  required,
  disabled,
  id = 'place-picker',
  error,
  className,
  textFallbackPlaceholder,
  showMap = true,
  placeholder,
  countries,
  biasCountry,
  requireResolved = false,
}: PlacePickerProps) {
  const apiKey = readGoogleMapsKey();
  const [textOnly, setTextOnly] = useState(value?.label ?? '');

  useEffect(() => {
    if (value?.label) setTextOnly(value.label);
  }, [value?.label]);

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (!apiKey) {
    // NO KEY AND THE CONSUMER DEMANDS A RESOLVED PLACE, so there is nothing this
    // field can be given that would be accepted. Say that, rather than rendering an
    // input whose every value is refused on save with "Select a suggested address" —
    // an instruction that cannot be followed when there are no suggestions.
    //
    // Disabled rather than hidden: the requirement stays visible, so it reads as a
    // deployment that is not finished rather than a step that has silently vanished.
    if (requireResolved) {
      return (
        <div className={cn('space-y-2', className)}>
          {label ? (
            <Label htmlFor={id}>
              {label}
              {required ? <span className="text-destructive"> *</span> : null}
            </Label>
          ) : null}
          <input
            id={id}
            className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-body text-muted-foreground"
            value=""
            disabled
            readOnly
            placeholder="Address search unavailable"
            aria-describedby={errorId}
          />
          <p id={errorId} role="alert" className="text-body text-destructive">
            Address search is not configured on this deployment, so a verified
            address cannot be entered. This step needs a Google Maps API key.
          </p>
        </div>
      );
    }

    return (
      <div className={cn('space-y-2', className)}>
        {label ? (
          <Label htmlFor={id}>
            {label}
            {required ? <span className="text-destructive"> *</span> : null}
          </Label>
        ) : null}
        <input
          id={id}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-body"
          value={textOnly}
          disabled={disabled}
          placeholder={textFallbackPlaceholder ?? 'Suburb or meeting place'}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hintId}
          onChange={(event) => {
            const labelText = event.target.value;
            setTextOnly(labelText);
            if (!labelText.trim()) {
              onChange(null);
              return;
            }
            onChange({
              label: labelText.trim(),
              placeId: `text:${labelText.trim()}`,
              // Not a real location — see `isUnresolved`. No map is drawn for these.
              lat: FALLBACK_MAP_CENTER.lat,
              lng: FALLBACK_MAP_CENTER.lng,
              countryCode: null,
              precision,
            });
          }}
        />
        {!error ? (
          <p id={hintId} className="text-body text-muted-foreground">
            {hint ? `${hint} ` : null}
            Address search unavailable until a Google Maps API key is configured.
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-body text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const showMapPreview = showMap && value != null && !isUnresolved(value);

  return (
    <div className={cn('space-y-2', className)}>
      {label ? (
        <Label htmlFor={id}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </Label>
      ) : null}

      <PlaceSearch
        id={id}
        precision={precision}
        value={value}
        disabled={disabled}
        countries={countries}
        biasCountry={biasCountry}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        placeholder={
          placeholder ??
          (precision === 'suburb'
            ? 'Search suburb or city'
            : 'Search a meeting place, street, or landmark')
        }
        onSelect={onChange}
        onClear={() => onChange(null)}
        onTextFallback={(text) => {
          // ANY divergence from the selected label drops the selection, not just an
          // empty field. Previously only empty text cleared it, so editing "Richmond"
          // to "Richmond VA" left the old place selected and the sync effect restored
          // the old label — the field appeared locked after one choice.
          if (!value) return;
          if (text.trim() !== value.label.trim()) onChange(null);
        }}
      />

      {showMapPreview ? (
        <PlaceMap
          lat={value.lat}
          lng={value.lng}
          label={value.label}
          precision={value.precision}
          heightClassName="h-48"
        />
      ) : null}

      {hint && !error ? (
        <p id={hintId} className="text-body text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
