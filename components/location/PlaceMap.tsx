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
import { HugeiconsIcon } from '@hugeicons/react';
import { ExternalLinkIcon, MapPinIcon } from '@hugeicons/core-free-icons';

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
  /**
   * `map` (default) is a framed preview. `inline` is a fact row — pin, label,
   * Open in Maps — for surfaces that already have a Card nearby and must not
   * grow a second box.
   */
  presentation?: 'map' | 'inline';
  /** Kept for call-site compatibility. */
  interactive?: boolean;
}

function LocationRow({
  label,
  href,
  className,
}: {
  label: string;
  href?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <HugeiconsIcon icon={MapPinIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-body">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-body font-semibold underline-offset-4 hover:underline"
        >
          Open in Maps
          <HugeiconsIcon icon={ExternalLinkIcon} className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

export function PlaceMap({
  lat,
  lng,
  label,
  className,
  heightClassName = 'h-64',
  precision = null,
  presentation = 'map',
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

  if (presentation === 'inline') {
    return (
      <LocationRow
        label={label ?? (hasCoords ? 'Unknown location' : 'No map location yet')}
        href={externalUrl}
        className={className}
      />
    );
  }

  // No coordinates — empty placeholder
  if (!hasCoords) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed border-border bg-muted text-body text-muted-foreground',
          'h-14',
          className,
        )}
      >
        <span className="inline-flex items-center gap-2">
          <HugeiconsIcon icon={MapPinIcon} className="size-4" aria-hidden />
          No map location yet
        </span>
      </div>
    );
  }

  // ─── Suburb precision: static map image ─────────────────────────────────────
  if (precision === 'suburb') {
    const imgUrl = staticMapUrl(lat, lng, { precision: 'suburb' });

    if (!imgUrl || imgFailed) {
      return (
        <LocationRow
          label={label ?? 'Unknown location'}
          href={externalUrl}
          className={className}
        />
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
              <HugeiconsIcon icon={ExternalLinkIcon} className="h-3.5 w-3.5" aria-hidden />
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
          'flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted p-4 text-center text-body',
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
          <HugeiconsIcon icon={ExternalLinkIcon} className="h-3.5 w-3.5" aria-hidden />
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
            <HugeiconsIcon icon={ExternalLinkIcon} className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}
