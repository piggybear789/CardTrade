'use client';

// components/layout/RegionIndicator.tsx
//
// Interactive region selector in the site header, rendered as a modal dialog.
//
// Only TRADEABLE regions are shown — browse-only regions clutter the list with
// options the member cannot transact in. "All regions" remains for anyone who
// wants to see everything.

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * The `?region=` value meaning "every region".
 *
 * Duplicated from `lib/location/resolveRegion.ts` rather than imported: that module
 * is `server-only` and this is a client component.
 */
const ALL_REGIONS_PARAM = 'all';

/** Only show regions that are actually tradeable. */
const TRADEABLE_REGIONS = REGIONS.filter((r) => r.tradingEnabled);

export interface RegionIndicatorProps {
  /** Resolved browse region, or null when unscoped. */
  regionCode: string | null;
  /** Where it came from — decides whether the subtitle explains itself. */
  source: RegionSource;
}

export function RegionIndicator({ regionCode, source }: RegionIndicatorProps) {
  // Only one tradeable region (AU) exists right now. Showing a region picker
  // that offers one option plus "All regions" is noise — hide it entirely until
  // a second region is enabled.
  if (TRADEABLE_REGIONS.length <= 1) return null;
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
      await setBrowseRegion(newCode);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          'hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-parchment/70 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:inline-flex',
          isPending && 'opacity-60',
        )}
        aria-label={`Browse region: ${label}. Click to change.`}
      >
        <MapPin className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose your region</DialogTitle>
          <DialogDescription>
            {isGuessed
              ? 'Set from your location. Deals complete within one region.'
              : 'Deals complete within one region, so postage and payouts stay local.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 py-2" role="listbox" aria-label="Select a region">
          {TRADEABLE_REGIONS.map((region) => {
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
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  selected
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground hover:bg-accent/50',
                )}
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    selected ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />
                <span className="flex-1">{region.label}</span>
              </button>
            );
          })}
          <div className="my-1 border-t" />
          <button
            type="button"
            role="option"
            aria-selected={!regionCode}
            onClick={() => selectRegion(ALL_REGIONS_PARAM)}
            disabled={isPending}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              !regionCode
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-foreground hover:bg-accent/50',
            )}
          >
            <Check
              className={cn(
                'size-4 shrink-0',
                !regionCode ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden
            />
            <span className="flex-1">All regions</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
