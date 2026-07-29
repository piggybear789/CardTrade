'use client';

// Read-only Mapbox map with a single marker. Dynamically imports mapbox-gl so
// the SSR bundle never touches the browser-only library.

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

import { mapsExternalUrl, readMapboxToken } from '@/lib/location/mapbox';
import { cn } from '@/lib/utils';

export interface PlaceMapProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
  className?: string;
  /** Map height; default 12rem. */
  heightClassName?: string;
  interactive?: boolean;
}

export function PlaceMap({
  lat,
  lng,
  label,
  className,
  heightClassName = 'h-48',
  interactive = false,
}: PlaceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const token = readMapboxToken();
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  useEffect(() => {
    if (!hasCoords || !token || !containerRef.current) return;

    let cancelled = false;
    let map: import('mapbox-gl').Map | null = null;
    let marker: import('mapbox-gl').Marker | null = null;

    void (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        await import('mapbox-gl/dist/mapbox-gl.css');
        if (cancelled || !containerRef.current) return;

        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [lng!, lat!],
          zoom: 12,
          interactive,
          attributionControl: true,
        });
        marker = new mapboxgl.Marker({ color: '#0f172a' })
          .setLngLat([lng!, lat!])
          .addTo(map);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      marker?.remove();
      map?.remove();
    };
  }, [hasCoords, token, lat, lng, interactive]);

  if (!hasCoords) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground',
          heightClassName,
          className,
        )}
      >
        <span className="inline-flex items-center gap-2">
          <MapPin className="h-4 w-4" aria-hidden />
          No map location yet
        </span>
      </div>
    );
  }

  if (!token || failed) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 p-4 text-center text-sm',
          heightClassName,
          className,
        )}
      >
        <p className="font-medium text-foreground">{label ?? 'Meeting point'}</p>
        <a
          href={mapsExternalUrl(lat!, lng!, label ?? undefined)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold underline-offset-4 hover:underline"
        >
          Open in Maps
        </a>
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border', className)}>
      <div ref={containerRef} className={cn('w-full', heightClassName)} />
      {label ? (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">{label}</span>
          <a
            href={mapsExternalUrl(lat!, lng!, label)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 font-semibold underline-offset-4 hover:underline"
          >
            Open
          </a>
        </div>
      ) : null}
    </div>
  );
}
