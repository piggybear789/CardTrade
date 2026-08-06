// components/layout/RegionIndicator.tsx
//
// Read-only display of the region the catalog is scoped to, for the top bar.
//
// DELIBERATELY NOT A SECOND CONTROL. The region is a URL parameter owned by
// `CatalogControls`, which is where every other catalog predicate lives and what
// makes a filtered view shareable. A picker here as well would mean two writers
// for one value, and they would disagree the moment either changed without the
// other — the same "two answers to one question" failure that a duplicated
// verification column caused once already (0049). So this reads the resolved scope
// and links to the control rather than replacing it.
//
// It renders nothing at all when the scope is worldwide: there is no scope to
// disclose, and a permanent "All regions" chip is noise in a 16px-tall bar that
// already competes for space with search, notifications, the profile shortcut and
// the menu.

import Link from 'next/link';
import { MapPin } from 'lucide-react';

import {
  isGuessedRegionSource,
  regionLabel,
  type RegionSource,
} from '@/domain/region';

export interface RegionIndicatorProps {
  /** Resolved browse region, or null when unscoped. */
  regionCode: string | null;
  /** Where it came from — decides how much explaining the tooltip does. */
  source: RegionSource;
}

export function RegionIndicator({ regionCode, source }: RegionIndicatorProps) {
  if (!regionCode) return null;

  const label = regionLabel(regionCode);
  // A guessed scope gets a fuller explanation, because the member never asked for
  // it and may not realise anything is being filtered.
  const title = isGuessedRegionSource(source)
    ? `Showing listings in ${label}, based on where you appear to be. Choose a different region in the marketplace filters.`
    : `Showing listings in ${label}. Change it in the marketplace filters.`;

  return (
    <Link
      href="/listings"
      title={title}
      /*
        The visible text is a bare country name, which says nothing on its own when
        read out of context by a screen reader. The accessible name carries the
        whole statement instead.
      */
      aria-label={title}
      /*
        Matches the header's own type scale — `text-sm font-semibold` and a `size-4`
        icon, the same as the nav links and the profile shortcut, which are `Button
        size="sm"`. This was `text-xs font-medium` with a `size-3.5` icon, so it read
        a step smaller than everything beside it in the same row.

        De-emphasis is carried by COLOUR (`text-parchment/70`), not by size: the
        region is secondary information, but shrinking it broke the row's alignment
        rather than creating hierarchy.
      */
      className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-parchment/70 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:inline-flex"
    >
      <MapPin className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}
