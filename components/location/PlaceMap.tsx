'use client';

// Read-only location preview.
//
// Two presentation modes based on what the pin actually means:
//
//   `suburb` — a locality centroid ("based near"). Uses Google Maps Static API
//   to render a clean map image with a pin — no iframe overhead, no Google
//   branding bar eating the frame. Compact and fast.
//
//   `exact` — a specific meeting point or address. Uses Google Maps Embed API
//   for a full interactive iframe so the user can pan, zoom, and orient
//   themselves for a real-world meetup.

import { useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';

import { embedMapUrl, mapsExternalUrl, staticMapUrl } from '@/lib/location/googleMaps';
import type { PlacePrecision } from '@/lib/location/types';
import { cn } from '@/lib/utils';

export interface PlaceMapProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
  className?: string;
  /** Map height for `exact` precision iframe; default 16rem. */
  heightClassName?: string;
  /**
   * What the coordinates mean. `suburb` renders a static map image.
   * `exact` renders a full interactive Google Maps Embed. Defaults to `exact`.
   */
  precision?: PlacePrecision | null;
  /** Kept for call-site compatibility. */
  interactive?: boolean;
}

export function PlaceMap({
  lat,
  lng,
  label,
  className,
  heightClassName = 'h-64',
  precision = null,
}: PlaceMapProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);

  const externalUrl = hasCoords
    ? mapsExternalUrl(lat, lng, label ?? undefined)
    : null;

  // No coordinates — empty placeholder
  if (!hasCoords) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed bg-muted/40 text-body text-muted-foreground',
          'h-14',
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

  // ─── Suburb precision: static map image ─────────────────────────────────────
  if (precision === 'suburb') {
    const imgUrl = staticMapUrl(lat, lng, { precision: 'suburb' });

    if (!imgUrl || imgFailed) {
      // Fallback: compact card if static API unavailable
      return (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border bg-muted/30 px-group py-cozy',
            className,
          )}
        >
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body font-medium">
            {label ?? 'Unknown location'}
          </span>
          <a
            href={externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-body font-semibold underline-offset-4 hover:underline"
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
          className="relative block h-36 w-full overflow-hidden bg-muted"
          aria-label={label ? `Open ${label} in Maps` : 'Open location in Maps'}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- remote static map */}
          <img
            src={imgUrl}
            alt={label ? `Map of ${label}` : 'Location map'}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        </a>
        {label ? (
          <div className="flex items-center justify-between gap-3 border-t px-cozy py-snug text-body">
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

  // ─── Exact precision: full interactive Google Maps Embed ─────────────────────
  const iframeSrc = embedMapUrl(lat, lng, { precision: 'exact' });

  if (!iframeSrc) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 p-4 text-center text-body',
          'h-32',
          className,
        )}
      >
        <p className="font-medium text-foreground">{label ?? 'Meeting point'}</p>
        <a
          href={externalUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-tight text-body font-semibold underline-offset-4 hover:underline"
        >
          Open in Maps
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border', className)}>
      <div className={cn('relative w-full overflow-hidden bg-muted', heightClassName)}>
        <iframe
          src={iframeSrc}
          className="h-full w-full border-0"
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          title={label ? `Map of ${label}` : 'Location map'}
        />
      </div>
      {label ? (
        <div className="flex items-center justify-between gap-3 border-t px-cozy py-snug text-body">
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
