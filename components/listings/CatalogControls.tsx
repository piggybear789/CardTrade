'use client';

// URL-driven controls for the server-rendered marketplace (Req 3.8, Phase 7).
// Filters update search params, reset pagination, and preserve server ownership of
// catalog querying. Prices remain readable dollars in the URL and integer cents
// at the action boundary.

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Check,
  ChevronRight,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { HeaderSearch } from '@/components/layout/HeaderSearch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { CURRENCY_CODE, CURRENCY_LOCALE } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CatalogSort } from '@/lib/actions/listings';

const SORT_LABELS: Record<CatalogSort, string> = {
  newest: 'Recently Listed',
  'price-asc': 'Price: Low to High',
  'price-desc': 'Price: High to Low',
  rating: 'Seller Rating: High to Low',
};

const AUD_FORMATTER = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  maximumFractionDigits: 2,
});

/**
 * Whole dollars for the price slider readout. Exact rather than rounded: the
 * slider's step is always a whole number of dollars, so every reachable value
 * lands on one.
 */
const AUD_WHOLE_FORMATTER = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  maximumFractionDigits: 0,
});

/** Price ceiling used when nothing is listed yet, so the slider still spans. */
const FALLBACK_CEILING_CENTS = 100_000;

/** Price slider stops below $10, where the bulk of listings sit. */
const LOW_PRICE_STOPS_CENTS = [0, 200, 500];

/**
 * Repeated for every decade from $10 up to the ceiling. Every multiplier lands
 * on a whole number of dollars at each decade, so no stop needs cents.
 */
const PRICE_DECADE_MULTIPLIERS = [1, 1.5, 2, 3, 4, 5, 7.5];

/** Condition filter options — matches ItemForm + adds "Graded" as a bucket. */
const CONDITION_OPTIONS = [
  'Graded',
  'Unopened',
  'Mint',
  'Near Mint',
  'Lightly Played',
  'Heavily Played',
  'Damaged',
] as const;

/** Current URL-backed catalog filter values. */
export interface CatalogFilterState {
  q: string;
  categories: string[];
  conditions: string[];
  /** Dollar strings suitable for filter inputs; empty when unset. */
  min: string;
  max: string;
  /** Include sold items in results. */
  includeSold: boolean;
}

/** Merge URL updates, remove blank values, and reset the result page. */
function useCatalogNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const pushWith = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (Array.isArray(value)) {
          for (const entry of value) if (entry !== '') params.append(key, entry);
        } else if (value != null && value !== '') {
          params.set(key, value);
        }
      }
      params.delete('page');
      const query = params.toString();
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
    },
    [pathname, router, searchParams],
  );

  const reset = useCallback(() => {
    startTransition(() => router.push(pathname));
  }, [pathname, router]);

  return { isPending, pushWith, reset };
}

export interface CatalogFiltersProps {
  facets: { categories: string[]; maxPriceCents: number };
  current: CatalogFilterState;
  /** Mobile Sell button target; omitted when the page keeps Sell elsewhere. */
  mobileSellHref?: string;
}
/** Marketplace navigation and filter rail, collapsed into a disclosure on mobile. */
export function CatalogFilters({
  facets,
  current,
  mobileSellHref = '/listings/new',
}: CatalogFiltersProps) {
  const { isPending, pushWith, reset } = useCatalogNav();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Rounding the ceiling up to a legible figure keeps the track's top end
  // stable as inventory comes and goes, rather than shifting on every new
  // high-value listing.
  const ceilingCents = niceCeilingCents(facets.maxPriceCents);
  const priceLadder = useMemo(
    () => buildPriceLadderCents(ceilingCents),
    [ceilingCents],
  );
  const topStop = priceLadder.length - 1;

  // The slider moves between ladder positions, not dollars, so each step is
  // proportionate to the price it lands on. The URL still carries plain dollars.
  const urlMinStop = current.min
    ? nearestPriceStop(priceLadder, Number(current.min) * 100)
    : 0;
  const urlMaxStop = current.max
    ? nearestPriceStop(priceLadder, Number(current.max) * 100)
    : topStop;

  // The URL owns the committed range; this holds the in-flight drag so the
  // readout tracks the thumbs without a server round trip per pixel.
  const [priceStops, setPriceStops] = useState<[number, number]>([
    urlMinStop,
    urlMaxStop,
  ]);

  useEffect(() => setPriceStops([urlMinStop, urlMaxStop]), [urlMinStop, urlMaxStop]);

  const hasActiveFilters =
    current.q !== '' ||
    current.categories.length > 0 ||
    current.conditions.length > 0 ||
    current.min !== '' ||
    current.max !== '' ||
    current.includeSold;

  // Search has its own field on mobile — the Filters badge counts refine-only.
  const refineCount =
    current.categories.length +
    current.conditions.length +
    Number(Boolean(current.min || current.max)) +
    Number(current.includeSold);

  function toggleCategory(category: string) {
    const next = current.categories.includes(category)
      ? current.categories.filter((value) => value !== category)
      : [...current.categories, category];
    pushWith({ category: next });
  }

  function toggleCondition(condition: string) {
    const next = current.conditions.includes(condition)
      ? current.conditions.filter((value) => value !== condition)
      : [...current.conditions, condition];
    pushWith({ condition: next });
  }

  function commitPrices([minStop, maxStop]: [number, number]) {
    pushWith({
      min: minStop > 0 ? dollarsParam(priceLadder[minStop]) : null,
      // A thumb parked at the top means "no upper limit", not "at most the
      // ceiling" — sending it would drop the very items it was rounded past.
      max: maxStop < topStop ? dollarsParam(priceLadder[maxStop]) : null,
    });
  }

  function clearFilters() {
    setPriceStops([0, topStop]);
    reset();
  }

  return (
    <div
      className={cn(
        'min-w-0 transition-opacity',
        // Filtering is a server round trip, so show the wait rather than
        // leaving the rail looking unresponsive.
        isPending && 'opacity-60',
      )}
      aria-busy={isPending}
    >
      <div className="flex flex-col gap-2 py-3 lg:hidden">
        <HeaderSearch />
        <div className="grid grid-cols-2 gap-2">
          <Button
            asChild
            className="border border-white/15 bg-obsidian font-semibold text-parchment shadow-sm hover:border-white/25 hover:bg-obsidian/80"
          >
            <Link href={mobileSellHref}>
              <Plus aria-hidden="true" className="text-gold" />
              Sell
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="catalog-filter-panel"
          >
            Filters
            {refineCount > 0 ? (
              <span className="flex size-5 items-center justify-center rounded-full border border-gold/40 bg-gold/20 text-[0.6875rem] font-semibold text-foreground">
                {refineCount}
              </span>
            ) : null}
          </Button>
        </div>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            disabled={isPending}
            className="self-start rounded-sm text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div
        id="catalog-filter-panel"
        className={cn(
          'space-y-5 rounded-xl border border-border/70 bg-card p-4 shadow-market lg:mt-4 lg:block lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-t lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-4 lg:shadow-none',
          filtersOpen ? 'mb-3 block' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Refine Results</h2>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              disabled={isPending}
              className="hidden rounded-sm text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:inline"
            >
              Clear All
            </button>
          ) : null}
        </div>

        {facets.categories.length > 0 ? (
          <fieldset className="border-t border-border/70 pt-5">
            <legend className="market-label mb-2 text-muted-foreground">Categories</legend>
            <div className="space-y-0.5">
              {facets.categories.map((category) => {
                const active = current.categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    disabled={isPending}
                    aria-pressed={active}
                    className={cn(
                      // Taller rows on touch screens (~44px target); compact in
                      // the desktop rail where a pointer is precise.
                      'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 lg:py-2.5',
                      active
                        ? 'bg-gold/10 font-semibold text-foreground'
                        : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                      {active ? (
                        <Check className="size-4 text-gold" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{category}</span>
                    {active ? <ChevronRight className="size-4 text-gold" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="border-t border-border/70 pt-5">
          <legend className="market-label mb-2 text-muted-foreground">Condition</legend>
          <div className="space-y-0.5">
            {CONDITION_OPTIONS.map((condition) => {
              const active = current.conditions.includes(condition);
              return (
                <button
                  key={condition}
                  type="button"
                  onClick={() => toggleCondition(condition)}
                  disabled={isPending}
                  aria-pressed={active}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 lg:py-2.5',
                    active
                      ? 'bg-gold/10 font-semibold text-foreground'
                      : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    {active ? (
                      <Check className="size-4 text-gold" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{condition}</span>
                  {active ? <ChevronRight className="size-4 text-gold" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="border-t border-border/70 pt-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <p className="market-label text-muted-foreground">Price</p>
            {/* Tabular figures so the readout does not jitter mid-drag. */}
            <p className="text-xs font-semibold tabular-nums">
              {priceRangeLabel(priceLadder, priceStops, topStop)}
            </p>
          </div>
          <Slider
            value={priceStops}
            onValueChange={(next) => setPriceStops([next[0], next[1]])}
            // Commit on release, not on change: every drag step would otherwise
            // be its own navigation and re-query.
            onValueCommit={(next) => commitPrices([next[0], next[1]])}
            min={0}
            max={topStop}
            step={1}
            minStepsBetweenThumbs={1}
            thumbLabels={['Minimum price', 'Maximum price']}
            // Thumbs carry a ladder position; announce the price it stands for.
            thumbValueText={(stop) => priceStopLabel(priceLadder, stop, topStop)}
            // Room for the thumbs' focus rings, which sit outside the track.
            className="px-0.5 py-2"
          />
          <div
            className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground tabular-nums"
            aria-hidden="true"
          >
            <span>{AUD_WHOLE_FORMATTER.format(0)}</span>
            <span>{AUD_WHOLE_FORMATTER.format(ceilingCents / 100)}+</span>
          </div>
        </div>

        {/* The "ID-verified sellers only" toggle used to sit here. Removed because
            publishing a listing now requires the Identity_Gate, so every item in
            the catalog has a verified seller and the filter matched all of them.
            Offering it implied the unfiltered catalog contained unverified
            sellers, which is the opposite of what is true. Per-card badges still
            show each seller's verified given name. */}

        <div className="border-t border-border/70 pt-5">
          <p className="market-label mb-2 text-muted-foreground">Availability</p>
          <button
            type="button"
            onClick={() => pushWith({ sold: current.includeSold ? null : '1' })}
            disabled={isPending}
            aria-pressed={current.includeSold}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 lg:py-2.5',
              current.includeSold
                ? 'bg-gold/10 font-semibold text-foreground'
                : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              {current.includeSold ? (
                <Check className="size-4 text-gold" />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              Include sold items
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
/** Removable chips summarizing every active catalog constraint. */
export function CatalogActiveFilters({ current }: { current: CatalogFilterState }) {
  const { isPending, pushWith, reset } = useCatalogNav();
  const hasFilters =
    Boolean(current.q) ||
    current.categories.length > 0 ||
    current.conditions.length > 0 ||
    Boolean(current.min) ||
    Boolean(current.max) ||
    current.includeSold;

  if (!hasFilters) return null;

  const priceLabel = current.min && current.max
    ? `${AUD_FORMATTER.format(Number(current.min))}–${AUD_FORMATTER.format(Number(current.max))}`
    : current.min
      ? `From ${AUD_FORMATTER.format(Number(current.min))}`
      : `Up to ${AUD_FORMATTER.format(Number(current.max))}`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-4" aria-label="Active filters">
      {current.q ? (
        <FilterChip label={`“${current.q}”`} onRemove={() => pushWith({ q: null })} disabled={isPending} />
      ) : null}
      {current.categories.map((category) => (
        <FilterChip
          key={category}
          label={category}
          onRemove={() => pushWith({
            category: current.categories.filter((value) => value !== category),
          })}
          disabled={isPending}
        />
      ))}
      {current.conditions.map((condition) => (
        <FilterChip
          key={condition}
          label={condition}
          onRemove={() => pushWith({
            condition: current.conditions.filter((value) => value !== condition),
          })}
          disabled={isPending}
        />
      ))}
      {current.min || current.max ? (
        <FilterChip
          label={priceLabel}
          onRemove={() => pushWith({ min: null, max: null })}
          disabled={isPending}
        />
      ) : null}
      {current.includeSold ? (
        <FilterChip
          label="Including sold"
          onRemove={() => pushWith({ sold: null })}
          disabled={isPending}
        />
      ) : null}
      <button
        type="button"
        onClick={reset}
        disabled={isPending}
        className="rounded-sm px-1 py-1.5 text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        Clear all
      </button>
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
  disabled,
}: {
  label: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gold/30 bg-gold/8 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gold/16 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      aria-label={`Remove ${label} filter`}
    >
      <span className="truncate">{label}</span>
      <X className="size-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/** Compact result-order selector for the catalog heading. */
export function CatalogSortControl({ current }: { current: CatalogSort }) {
  const { pushWith } = useCatalogNav();

  return (
    <div className="flex items-center gap-2">
      <SlidersHorizontal className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      <Select
        value={current}
        onValueChange={(value) => pushWith({ sort: value === 'newest' ? null : value })}
      >
        <SelectTrigger className="w-full bg-card sm:w-[190px]" aria-label="Sort listings">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABELS) as CatalogSort[]).map((key) => (
            <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Cents to the readable dollar string the catalog URL carries. */
function dollarsParam(cents: number): string {
  return String(Math.round(cents) / 100);
}

/**
 * Round a cents figure up to the next 1, 2, or 5 × 10ⁿ. Used for the slider's
 * top end so the track reads in round numbers and only moves when inventory
 * crosses an order of magnitude, rather than on every new high-value listing.
 */
function niceCeilingCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return FALLBACK_CEILING_CENTS;
  const magnitude = 10 ** Math.floor(Math.log10(cents));
  for (const multiple of [1, 2, 5]) {
    const candidate = multiple * magnitude;
    if (candidate >= cents) return candidate;
  }
  return 10 * magnitude;
}

/**
 * The prices the range slider can land on, a handful per order of magnitude
 * rather than one uniform step. A catalog spanning a few dollars to a few
 * thousand leaves a linear track no good option: a step fine enough for cheap
 * cards takes hundreds of key presses to cross, and one coarse enough to cross
 * is wider than most listings are worth. Stepping by magnitude keeps the low
 * end precise and the top end reachable.
 */
function buildPriceLadderCents(ceilingCents: number): number[] {
  const stops = LOW_PRICE_STOPS_CENTS.filter((cents) => cents < ceilingCents);
  for (let decadeCents = 1000; decadeCents < ceilingCents; decadeCents *= 10) {
    for (const multiplier of PRICE_DECADE_MULTIPLIERS) {
      const cents = multiplier * decadeCents;
      if (cents < ceilingCents) stops.push(cents);
    }
  }
  stops.push(ceilingCents);
  return stops;
}

/**
 * Ladder position closest to a price, for seeding the thumbs from the URL.
 * Hand-written URLs can name any amount; the thumb takes the nearest stop.
 */
function nearestPriceStop(ladder: number[], cents: number): number {
  let nearest = 0;
  let smallestGap = Infinity;
  for (let stop = 0; stop < ladder.length; stop += 1) {
    const gap = Math.abs(ladder[stop] - cents);
    if (gap < smallestGap) {
      nearest = stop;
      smallestGap = gap;
    }
  }
  return nearest;
}

/** The price a single thumb stands for, spoken form included. */
function priceStopLabel(ladder: number[], stop: number, topStop: number): string {
  const price = AUD_WHOLE_FORMATTER.format(ladder[stop] / 100);
  return stop >= topStop ? `${price} or more` : price;
}

/** Plain-language summary of the selected range for the rail readout. */
function priceRangeLabel(
  ladder: number[],
  [minStop, maxStop]: [number, number],
  topStop: number,
): string {
  const openEnded = maxStop >= topStop;
  if (minStop <= 0 && openEnded) return 'Any price';
  const from = AUD_WHOLE_FORMATTER.format(ladder[minStop] / 100);
  if (openEnded) return `${from}+`;
  return `${from} – ${AUD_WHOLE_FORMATTER.format(ladder[maxStop] / 100)}`;
}
