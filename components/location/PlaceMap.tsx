'use client';

// Read-only location preview: Geoapify static map image + Open in Maps link.
// No interactive map SDK — keeps the client bundle free of map libraries.

import { useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';

import { mapsExternalUrl, staticMapUrl } from '@/lib/location/geoapify';
import { cn } from '@/lib/utils';

export interface PlaceMapProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
  className?: string;
  /** Map height; default 12rem. */
  heightClassName?: string;
  /** Kept for call-site compatibility; static maps are non-interactive. */
  interactive?: boolean;
}

export function PlaceMap({
  lat,
  lng,
  label,
  className,
  heightClassName = 'h-48',
}: PlaceMapProps) {
  const [failed, setFailed] = useState(false);
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  const imageUrl = hasCoords ? staticMapUrl(lat, lng) : null;
  const externalUrl = hasCoords
    ? mapsExternalUrl(lat, lng, label ?? undefined)
    : null;

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

  if (!imageUrl || failed) {
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
          href={externalUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
        >
          Open in Maps
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border', className)}>
      <a
        href={externalUrl!}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('relative block w-full overflow-hidden bg-muted', heightClassName)}
        aria-label={label ? `Open ${label} in Maps` : 'Open location in Maps'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote static map; avoid next/image remote config */}
        <img
          src={imageUrl}
          alt={label ? `Map of ${label}` : 'Location map'}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </a>
      {label ? (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">{label}</span>
          <a
            href={externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-4 hover:underline"
          >
            Open
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}
