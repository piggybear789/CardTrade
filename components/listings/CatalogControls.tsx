'use client';

// Marketplace refine rail. After first paint, pills / sort / price / condition
// call CatalogView.apply — fetch in place, rewrite the URL, do not navigate.
// Prices stay readable dollars in the URL and integer cents at the action.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { DesktopOnly, MobileOnly } from '@/components/layout/Breakpoint';
import { subscribeCatalogFilters } from '@/lib/catalog/browseEvents';

import { useCatalogView } from '@/components/listings/CatalogView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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

/**
 * Whole dollars for the price slider readout. Exact rather than rounded: the
 * slider's step is always a whole number of dollars, so every reachable value
 * lands on one.
 */
const AUD_FORMATTER = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  maximumFractionDigits: 2,
});

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

/** Browse updates stay on the client — see CatalogViewProvider. */
function useCatalogNav() {
  const { apply, reset, isPending } = useCatalogView();
  return { isPending, pushWith: apply, reset };
}

/**
 * Instant filter over the listings already on the page. Does not touch the
 * URL — the header search is the one that runs a marketplace query.
 */
export function CatalogFilterSearch() {
  const { filter, setFilter } = useCatalogView();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="relative min-w-0 w-full sm:w-56">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        name="q"
        value={filter}
        data-catalog-filter=""
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (filter) setFilter('');
          }
        }}
        placeholder="Filter…"
        aria-label="Filter listings"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          'h-9 w-full bg-card pl-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          filter ? 'pr-9' : 'pr-3',
        )}
      />
      {filter ? (
        <button
          type="button"
          onClick={() => setFilter('')}
          aria-label="Clear listing filter"
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground border border-transparent focus:outline-none focus-visible:border-gold/40"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </form>
  );
}

/** Marketplace navigation and filter rail. Phone: sheet. Desktop: in-page rail. */
export function CatalogFilters() {
  const { current, facets } = useCatalogView();
  const { isPending, pushWith, reset } = useCatalogNav();
  // Closed until mount so a `?filters=1` deep link cannot open a portaled
  // sheet on desktop during SSR (MobileOnly assumes the phone snapshot).
  const [filtersOpen, setFiltersOpen] = useState(false);

  function setFiltersOpenAndUrl(next: boolean) {
    setFiltersOpen(next);
    const params = new URLSearchParams(window.location.search);
    if (next) params.set('filters', '1');
    else params.delete('filters');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', qs ? `/listings?${qs}` : '/listings');
  }

  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    if (new URLSearchParams(window.location.search).get('filters') === '1') {
      setFiltersOpen(true);
    }
  }, []);

  useEffect(() => subscribeCatalogFilters(setFiltersOpenAndUrl), []);

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
    current.conditions.length > 0 ||
    current.min !== '' ||
    current.max !== '' ||
    current.includeSold;

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
      className={cn('min-w-0', isPending && 'md:opacity-60 md:transition-opacity')}
      aria-busy={isPending}
    >
      <MobileOnly>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpenAndUrl}>
          <SheetContent side="bottom" className="gap-0 p-0">
            <SheetHeader className="border-b border-border px-5 py-3">
              <div className="flex items-start justify-between gap-3 pr-10">
                <div className="min-w-0">
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>
                    Sort, condition, price, and sold items. Changes apply immediately.
                  </SheetDescription>
                </div>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={isPending}
                    className="shrink-0 rounded-sm pt-0.5 text-body font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40 disabled:opacity-50"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
            </SheetHeader>
            <div className="space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
              <CatalogRefineFields
                current={current}
                isPending={isPending}
                hasActiveFilters={hasActiveFilters}
                onClear={clearFilters}
                onToggleCondition={toggleCondition}
                onToggleSold={() => pushWith({ sold: current.includeSold ? null : '1' })}
                priceStops={priceStops}
                onPriceStopsChange={setPriceStops}
                onPriceCommit={commitPrices}
                priceLadder={priceLadder}
                topStop={topStop}
                ceilingCents={ceilingCents}
                showHeading={false}
                choiceStyle="squares"
              />
            </div>
            <SheetFooter className="border-t border-border p-4">
              <SheetClose asChild>
                <Button type="button">Done</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </MobileOnly>

      <DesktopOnly>
        <div
          id="catalog-filter-panel"
          className="mt-4 space-y-5 border-t border-border bg-transparent pt-group"
        >
          <CatalogRefineFields
            current={current}
            isPending={isPending}
            hasActiveFilters={hasActiveFilters}
            onClear={clearFilters}
            onToggleCondition={toggleCondition}
            onToggleSold={() => pushWith({ sold: current.includeSold ? null : '1' })}
            priceStops={priceStops}
            onPriceStopsChange={setPriceStops}
            onPriceCommit={commitPrices}
            priceLadder={priceLadder}
            topStop={topStop}
            ceilingCents={ceilingCents}
            showHeading
            choiceStyle="list"
          />
        </div>
      </DesktopOnly>
    </div>
  );
}

function CatalogRefineFields({
  current,
  isPending,
  hasActiveFilters,
  onClear,
  onToggleCondition,
  onToggleSold,
  priceStops,
  onPriceStopsChange,
  onPriceCommit,
  priceLadder,
  topStop,
  ceilingCents,
  showHeading,
  choiceStyle,
}: {
  current: Pick<CatalogFilterState, 'conditions' | 'includeSold'>;
  isPending: boolean;
  hasActiveFilters: boolean;
  onClear: () => void;
  onToggleCondition: (condition: string) => void;
  onToggleSold: () => void;
  priceStops: [number, number];
  onPriceStopsChange: (next: [number, number]) => void;
  onPriceCommit: (next: [number, number]) => void;
  priceLadder: number[];
  topStop: number;
  ceilingCents: number;
  showHeading: boolean;
  choiceStyle: 'squares' | 'list';
}) {
  return (
    <>
      <div className="border-b border-border pb-group">
        <p className="market-label mb-2 text-muted-foreground">Sort</p>
        <CatalogSortControl fullWidth />
      </div>

      {showHeading ? (
        <div className="flex items-center justify-between">
          <h2 className="text-subhead font-semibold tracking-tight">Refine results</h2>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClear}
              disabled={isPending}
              className="rounded-sm text-body font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40 disabled:opacity-50"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      <fieldset className="border-t border-border pt-group">
        <legend className="market-label mb-2 text-muted-foreground">Condition</legend>
        {choiceStyle === 'squares' ? (
          <div className="flex flex-wrap gap-1.5">
            {CONDITION_OPTIONS.map((condition) => (
              <FilterSquare
                key={condition}
                label={condition}
                pressed={current.conditions.includes(condition)}
                onClick={() => onToggleCondition(condition)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-tight">
            {CONDITION_OPTIONS.map((condition) => (
              <FilterCheckRow
                key={condition}
                label={condition}
                pressed={current.conditions.includes(condition)}
                onClick={() => onToggleCondition(condition)}
                disabled={isPending}
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="border-t border-border pt-group">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className="market-label text-muted-foreground">Price</p>
          <p className="text-body font-semibold tabular-nums">
            {priceRangeLabel(priceLadder, priceStops, topStop)}
          </p>
        </div>
        <Slider
          value={priceStops}
          onValueChange={(next) => onPriceStopsChange([next[0], next[1]])}
          onValueCommit={(next) => onPriceCommit([next[0], next[1]])}
          min={0}
          max={topStop}
          step={1}
          minStepsBetweenThumbs={1}
          thumbLabels={['Minimum price', 'Maximum price']}
          thumbValueText={(stop) => priceStopLabel(priceLadder, stop, topStop)}
          className="px-tight py-2"
        />
        <div
          className="mt-1 flex justify-between text-meta text-muted-foreground tabular-nums"
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

      <div className="border-t border-border pt-group">
        <p className="market-label mb-2 text-muted-foreground">Availability</p>
        {choiceStyle === 'squares' ? (
          <FilterSquare
            label="Include sold"
            pressed={current.includeSold}
            onClick={onToggleSold}
          />
        ) : (
          <FilterCheckRow
            label="Include sold items"
            pressed={current.includeSold}
            onClick={onToggleSold}
            disabled={isPending}
          />
        )}
      </div>
    </>
  );
}
export function CatalogActiveFilters() {
  const { current, settled } = useCatalogView();
  const { isPending, pushWith, reset } = useCatalogNav();
  const hasFilters =
    settled.q !== '' ||
    settled.conditions.length > 0 ||
    Boolean(settled.min) ||
    Boolean(settled.max) ||
    settled.includeSold;

  if (!hasFilters) return null;

  const priceLabel = settled.min && settled.max
    ? `${AUD_FORMATTER.format(Number(settled.min))}–${AUD_FORMATTER.format(Number(settled.max))}`
    : settled.min
      ? `From ${AUD_FORMATTER.format(Number(settled.min))}`
      : `Up to ${AUD_FORMATTER.format(Number(settled.max))}`;

  return (
    <div className="mt-group flex flex-wrap items-center gap-snug" aria-label="Active filters">
      {settled.q ? (
        <FilterChip
          label={`“${settled.q}”`}
          onRemove={() => pushWith({ q: null })}
          disabled={isPending}
        />
      ) : null}
      {settled.conditions.map((condition) => (
        <FilterChip
          key={condition}
          label={condition}
          onRemove={() => pushWith({
            condition: current.conditions.filter((value) => value !== condition),
          })}
          disabled={isPending}
        />
      ))}
      {settled.min || settled.max ? (
        <FilterChip
          label={priceLabel}
          onRemove={() => pushWith({ min: null, max: null })}
          disabled={isPending}
        />
      ) : null}
      {settled.includeSold ? (
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
        className="rounded-sm px-1 py-tight text-body font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40 disabled:opacity-50"
      >
        Clear all
      </button>
    </div>
  );
}

function FilterCheckRow({
  label,
  pressed,
  onClick,
  disabled,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        'flex w-full items-center gap-cozy rounded-lg px-cozy py-snug text-left text-body transition-colors border border-transparent focus:outline-none focus-visible:border-gold/40 disabled:opacity-60',
        pressed
          ? 'bg-gold/10 font-semibold text-foreground'
          : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {pressed ? (
          <Check className="size-4 text-gold" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pressed ? <ChevronRight className="size-4 text-gold" aria-hidden="true" /> : null}
    </button>
  );
}

function FilterSquare({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        'min-h-9 rounded-md border px-2.5 py-1.5 text-body font-medium transition-colors focus:outline-none focus-visible:border-gold/40',
        pressed
          ? 'border-gold bg-gold/10 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-gold/40 hover:text-foreground',
      )}
    >
      {label}
    </button>
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
      className="inline-flex min-h-9 max-w-full items-center gap-tight rounded-full border border-gold/40 bg-gold/8 px-cozy py-tight text-meta font-medium transition-colors hover:bg-gold/16 focus:outline-none focus-visible:border-gold/40 disabled:opacity-50"
      aria-label={`Remove ${label} filter`}
    >
      <span className="truncate">{label}</span>
      <X className="size-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/** Compact result-order selector for the catalog heading or the filter rail. */
export function CatalogSortControl({
  fullWidth = false,
}: {
  fullWidth?: boolean;
} = {}) {
  const { current } = useCatalogView();
  const { pushWith } = useCatalogNav();

  return (
    <div className="flex items-center gap-2">
      {fullWidth ? null : (
        <SlidersHorizontal className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      )}
      <Select
        value={current.sort}
        onValueChange={(value) => pushWith({ sort: value === 'newest' ? null : value })}
      >
        <SelectTrigger
          className={cn(fullWidth ? 'h-11 w-full' : 'w-full min-w-0 sm:w-[190px]')}
          aria-label="Sort listings"
        >
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
