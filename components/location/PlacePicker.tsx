'use client';

// Autocomplete place picker (suburb vs exact). No interactive map —
// selection comes from Geoapify Address Autocomplete suggestions.

import { useEffect, useState } from 'react';

import { readGeoapifyKey } from '@/lib/location/geoapify';
import { AU_DEFAULT_CENTER, type PlacePrecision, type PlaceValue } from '@/lib/location/types';
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
              lat: AU_DEFAULT_CENTER.lat,
              lng: AU_DEFAULT_CENTER.lng,
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        placeholder={
          precision === 'suburb'
            ? 'Search suburb or city'
            : 'Search a meeting place, street, or landmark'
        }
        onSelect={onChange}
        onTextFallback={(text) => {
          if (!text.trim()) onChange(null);
        }}
      />

      {value ? (
        <p className="text-xs text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{value.label}</span>
        </p>
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
