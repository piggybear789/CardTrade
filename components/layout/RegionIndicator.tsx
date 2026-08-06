'use client';

// components/layout/RegionIndicator.tsx
//
// Interactive region selector in the site header. Lets a visitor change which
// region's listings they see without hunting for it in the catalog filter rail.
//
// HISTORY. This was originally a read-only link that pointed to the catalog where
// a `RegionScopeField` lived as part of the filter panel. Relocating the control
// here makes the region choice immediately accessible from any page, and removes
// a filter-rail item that behaved differently from everything else there (it wrote
// a cookie and scoped the whole marketplace, where every other filter only refined
// the current view).
//
// It writes the same things the old `RegionScopeField` wrote:
//   1. A URL `?region=` param — scopes the catalog and keeps the view shareable.
//   2. A cookie via `setBrowseRegion` — survives navigation to pages that do not
//      carry the param (homepage, burger menu links, direct listing URLs).
//
// On routes OTHER than `/listings`, there is no catalog URL to update, so the
// control writes only the cookie and refreshes the page (the catalog will pick up
// the new cookie on its next render).

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, MapPin } from 'lucide-react';

import {
  isGuessedRegionSource,
  REGIONS,
  regionLabel,
  type RegionSource,
} from '@/domain/region';
import { setBrowseRegion } from '@/lib/actions/region';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * The `?region=` value meaning "every region".
 *
 * Duplicated from `lib/location/resolveRegion.ts` rather than imported: that module
 * is `server-only` (it reads request headers and cookies) and this is a client
 * component, so importing it would pull a server module into the browser bundle.
 */
const ALL_REGIONS_PARAM = 'all';

export interface RegionIndicatorProps {
  /** Resolved browse region, or null when unscoped. */
  regionCode: string | null;
  /** Where it came from — decides whether the tooltip explains itself. */
  source: RegionSource;
}

export function RegionIndicator({ regionCode, source }: RegionIndicatorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const label = regionCode ? regionLabel(regionCode) : 'All regions';

  function selectRegion(code: string) {
    setOpen(false);
    const newCode = code === ALL_REGIONS_PARAM ? null : code;

    startTransition(async () => {
      // Write the cookie so the preference survives across navigations.
      await setBrowseRegion(newCode);

      // On the catalog page, also update the URL param so it stays shareable.
      if (pathname === '/listings' || pathname.startsWith('/listings?')) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('page');
        if (code === ALL_REGIONS_PARAM) {
          params.delete('region');
        } else {
          params.set('region', code);
        }
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      } else {
        router.refresh();
      }
    });
  }

  const isGuessed = isGuessedRegionSource(source);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-parchment/70 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:inline-flex',
          isPending && 'opacity-60',
        )}
        aria-label={`Browse region: ${label}. Click to change.`}
      >
        <MapPin className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 p-2"
      >
        <div className="mb-2 px-2 pt-1">
          <p className="text-xs font-medium text-muted-foreground">
            {isGuessed
              ? 'Set from your location'
              : 'Browse region'}
          </p>
        </div>
        <div className="space-y-0.5" role="listbox" aria-label="Select a region">
          {REGIONS.map((region) => {
            const selected = regionCode === region.code;
            return (
              <button
                key={region.code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectRegion(region.code)}
                disabled={isPending}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  selected
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-popover-foreground hover:bg-accent/50',
                )}
              >
                <Check
                  className={cn(
                    'size-3.5 shrink-0',
                    selected ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />
                <span className="flex-1">{region.label}</span>
                {!region.tradingEnabled ? (
                  <span className="text-[0.6875rem] text-muted-foreground">browse only</span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            role="option"
            aria-selected={!regionCode}
            onClick={() => selectRegion(ALL_REGIONS_PARAM)}
            disabled={isPending}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              !regionCode
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-popover-foreground hover:bg-accent/50',
            )}
          >
            <Check
              className={cn(
                'size-3.5 shrink-0',
                !regionCode ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden
            />
            <span className="flex-1">All regions</span>
          </button>
        </div>
        <p className="mt-2 border-t px-2 pt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
          Deals complete within one region.
        </p>
      </PopoverContent>
    </Popover>
  );
}
