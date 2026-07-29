'use client';

// Search + interactive map for choosing a place. Suburb mode snaps labels to
// locality; exact mode allows street/POI pins for meetup points.

import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';

import { reverseGeocode, readMapboxToken } from '@/lib/location/mapbox';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const precisionRef = useRef(precision);
  const token = readMapboxToken();
  const [textOnly, setTextOnly] = useState(value?.label ?? '');

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    precisionRef.current = precision;
  }, [precision]);
  useEffect(() => {
    if (value?.label) setTextOnly(value.label);
  }, [value?.label]);

  useEffect(() => {
    if (!token || !containerRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        // @ts-expect-error — CSS import handled by bundler at runtime
        await import('mapbox-gl/dist/mapbox-gl.css');
        if (cancelled || !containerRef.current) return;

        mapboxgl.accessToken = token;
        const startLng = value?.lng ?? AU_DEFAULT_CENTER.lng;
        const startLat = value?.lat ?? AU_DEFAULT_CENTER.lat;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [startLng, startLat],
          zoom: value ? 13 : 10,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

        const marker = new mapboxgl.Marker({ color: '#0f172a', draggable: true })
          .setLngLat([startLng, startLat])
          .addTo(map);

        const applyCoords = async (lat: number, lng: number) => {
          marker.setLngLat([lng, lat]);
          map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12) });
          const place = await reverseGeocode(lat, lng, precisionRef.current);
          if (place) onChangeRef.current(place);
        };

        map.on('click', (event) => {
          void applyCoords(event.lngLat.lat, event.lngLat.lng);
        });
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          void applyCoords(lngLat.lat, lngLat.lng);
        });

        mapRef.current = map;
        markerRef.current = marker;
      } catch {
        // Leave text search working without the map canvas.
      }
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      mapRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
    // Mount once per token; pin syncs via the value effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!value || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLngLat([value.lng, value.lat]);
    mapRef.current.easeTo({ center: [value.lng, value.lat], zoom: Math.max(mapRef.current.getZoom(), 12) });
  }, [value]);

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (!token) {
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
            {hint} Map preview unavailable until a Mapbox token is configured.
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
    <div className={cn('space-y-3', className)}>
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

      <div
        ref={containerRef}
        className="h-52 w-full overflow-hidden rounded-lg border"
        aria-label="Map — click or drag the pin to set the location"
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
