'use client';

// Autocomplete place picker (suburb vs exact). No interactive map — selection
// comes from Geoapify Address Autocomplete suggestions, and the confirmation is a
// static map image.
//
// The map is here for ERROR PREVENTION, not decoration. Two suburbs share a name
// often enough that a text-only "Selected: Richmond" is not a confirmation of
// anything, and the mistake used to stay invisible until the deal room — by which
// point the terms were set. Showing where the pin landed at selection time is the
// cheapest check available.

import { useEffect, useState } from 'react';

import { readGeoapifyKey } from '@/lib/location/geoapify';
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
}: PlacePickerProps) {
  const apiKey = readGeoapifyKey();
  const [textOnly, setTextOnly] = useState(value?.label ?? '');

  useEffect(() => {
    if (value?.label) setTextOnly(value.label);
  }, [value?.label]);

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (!apiKey) {
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
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={textOnly}
          disabled={disabled}
          placeholder={textFallbackPlaceholder ?? 'Suburb or meeting place'}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
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
        {hint && !error ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint} Address search unavailable until a Geoapify key is configured.
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
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
          heightClassName="h-40"
        />
      ) : null}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
