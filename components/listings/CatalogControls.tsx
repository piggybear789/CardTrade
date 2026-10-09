'use client';

// Marketplace refine rail. After first paint, pills / sort / price / condition
// call CatalogView.apply — fetch in place, rewrite the URL, do not navigate.
// Prices stay readable dollars in the URL and integer cents at the action.

import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, CancelIcon, CheckIcon } from '@hugeicons/core-free-icons';

import { DesktopOnly, MobileOnly } from '@/components/layout/Breakpoint';
import {
  requestCatalogFilters,
  subscribeCatalogFilters,
  type CatalogFilterSection,
} from '@/lib/catalog/browseEvents';
import { ITEM_CONDITIONS } from '@/lib/catalog/conditions';
import {
  buildPriceLadderCents,
  nearestPriceStop,
  niceCeilingCents,
} from '@/lib/catalog/priceLadder';

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
  newest: 'Recently listed',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  rating: 'Seller rating: high to low',
};

const AUD_WHOLE_FORMATTER = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  maximumFractionDigits: 0,
});

/* The ladder constants — the decade multipliers, the fallback ceiling and the low-price
   stops — moved to `lib/catalog/priceLadder.ts` with the functions that used them, so
   the histogram buckets against the same stops the slider thumbs snap to. See the note
   there. */

/** Current URL-backed catalog filter values. */
export interface CatalogFilterState {
  q: string;
  categories: string[];
  /** Conditions, in the order `ITEM_CONDITIONS` lists them. */
  conditions: string[];
  /** Dollar strings suitable for filter inputs; empty when unset. */
  min: string;
  max: string;
  /** Include sold items in results. */
  includeSold: boolean;
  /** Include items under an active contract. Independent of {@link includeSold}. */
  includeReserved: boolean;
}

/** Plain-language summary of the selected conditions, for a property-row value. */
function conditionSummary(conditions: readonly string[]): string {
  const ordered = ITEM_CONDITIONS.filter((condition) => conditions.includes(condition));
  if (ordered.length === 0) return 'Any';
  if (ordered.length <= 2) return ordered.join(', ');
  return `${ordered.length} selected`;
}

/** Plain-language summary of the URL's price bounds (whole dollars), or null when unset. */
function priceSummary(min: string, max: string): string | null {
  const from = min ? AUD_WHOLE_FORMATTER.format(Number(min)) : null;
  const to = max ? AUD_WHOLE_FORMATTER.format(Number(max)) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `${from}+`;
  if (to) return `Up to ${to}`;
  return null;
}

/** One applied filter, as a chip that removes it. */
interface AppliedFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * What is narrowing the grid, under the game pills.
 *
 * DESKTOP: one chip per applied filter, each removing itself, and "Clear all". The
 * rail shows the controls; this shows the result of using them, beside the grid
 * they changed — nothing above the grid said what was applied or offered a reset.
 *
 * PHONE: the result count on the left, then Sort, Condition and Price chips that
 * open the sheet at their own section. All three sat behind one sliders icon, so a
 * phone showed no sign of what was filtering the grid or how to change it.
 */
export function CatalogFilterChips() {
  const { current, result, apply, reset, isPending } = useCatalogView();

  const applied: AppliedFilter[] = [];
  if (current.q) {
    applied.push({ key: 'q', label: `“${current.q}”`, onRemove: () => apply({ q: null }) });
  }
  for (const condition of ITEM_CONDITIONS) {
    if (!current.conditions.includes(condition)) continue;
    applied.push({
      key: `condition-${condition}`,
      label: condition,
      onRemove: () => apply({ condition: current.conditions.filter((value) => value !== condition) }),
    });
  }
  const price = priceSummary(current.min, current.max);
  if (price) {
    applied.push({ key: 'price', label: price, onRemove: () => apply({ min: null, max: null }) });
  }
  if (current.includeReserved) {
    applied.push({ key: 'reserved', label: 'Including reserved', onRemove: () => apply({ reserved: null }) });
  }
  if (current.includeSold) {
    applied.push({ key: 'sold', label: 'Including sold', onRemove: () => apply({ sold: null }) });
  }

  const conditionLabel =
    current.conditions.length > 0 ? conditionSummary(current.conditions) : 'Condition';
  const sortActive = current.sort !== 'newest';

  return (
    <>
      <MobileOnly>
        <div className="-mx-group flex items-center gap-snug overflow-x-auto px-group [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground" aria-live="polite">
            {result.total} {result.total === 1 ? 'listing' : 'listings'}
          </span>
          <PhoneFilterChip
            label={sortActive ? SORT_LABELS[current.sort] : 'Sort'}
            active={sortActive}
            onClick={() => requestCatalogFilters(true, 'sort')}
          />
          <PhoneFilterChip
            label={conditionLabel}
            active={current.conditions.length > 0}
            onClick={() => requestCatalogFilters(true, 'condition')}
          />
          <PhoneFilterChip
            label={price ?? 'Price'}
            active={Boolean(price)}
            onClick={() => requestCatalogFilters(true, 'price')}
          />
        </div>
      </MobileOnly>
      {applied.length > 0 ? (
        <DesktopOnly>
          <div className="flex flex-wrap items-center gap-snug" aria-label="Applied filters" role="group">
            {applied.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={filter.onRemove}
                disabled={isPending}
                aria-label={`Remove filter: ${filter.label}`}
                className="inline-flex h-8 items-center gap-tight rounded-full border border-border bg-card pl-cozy pr-snug text-meta font-medium text-foreground transition-colors hover:border-foreground/40 focus:outline-none focus-visible:border-iris disabled:opacity-60"
              >
                {filter.label}
                <HugeiconsIcon icon={CancelIcon} className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={isPending}>
              Clear all
            </Button>
          </div>
        </DesktopOnly>
      ) : null}
    </>
  );
}

function PhoneFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-tight rounded-full border px-cozy text-meta font-medium transition-colors focus:outline-none focus-visible:border-iris',
        active
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-border bg-card text-foreground',
      )}
    >
      {label}
      <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" aria-hidden />
    </button>
  );
}

/** Browse updates stay on the client — see CatalogViewProvider. */
function useCatalogNav() {
  const { apply, reset, isPending } = useCatalogView();
  return { isPending, pushWith: apply, reset };
}

/** Marketplace filter rail. Phone: bottom sheet. Desktop: in-page rows. */
export function CatalogFilters() {
  const { current, facets, result } = useCatalogView();
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
    window.history.replaceState(window.history.state, '', qs ? `/?${qs}` : '/');
  }

  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    if (new URLSearchParams(window.location.search).get('filters') === '1') {
      setFiltersOpen(true);
    }
  }, []);

  // Opening at a section (the phone chip row): the sheet portals in on open, so the
  // scroll waits a frame for the section to exist.
  useEffect(
    () =>
      subscribeCatalogFilters((open, section?: CatalogFilterSection) => {
        setFiltersOpenAndUrl(open);
        if (!open || !section) return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            document
              .getElementById(`catalog-sheet-${section}`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
          ),
        );
      }),
    [],
  );

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

  // `categories` belongs here for the MOUNTED controls, even though this component
  // no longer shows it: picking a game pill still applies a filter its chip cannot
  // unset, so the "Clear all" in the sheet and the "Reset" in the rail must still
  // appear — and `reset()` is the only thing that clears it.
  const hasActiveFilters =
    current.q !== '' ||
    current.categories.length > 0 ||
    current.conditions.length > 0 ||
    current.min !== '' ||
    current.max !== '' ||
    current.includeSold ||
    current.includeReserved;

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
            <SheetHeader className="border-b border-border px-5 py-cozy">
              <div className="min-w-0 pr-10">
                <SheetTitle>Filters</SheetTitle>
                {/* Visually hidden: the footer's live count now says what the filters
                    do, which is what this sentence used to explain. */}
                <SheetDescription className="sr-only">
                  Sort, condition, price and sold items. Changes apply as you make them.
                </SheetDescription>
              </div>
            </SheetHeader>
            <div className="space-y-group overflow-y-auto overscroll-contain px-5 py-group">
              {/* Sort belongs to the sheet, not to the shared refine fields.
                  On desktop it sits beside the result count in the catalog
                  header, where the thing being ordered is on screen; the sheet
                  is the only place a phone can reach it, so it leads here. */}
              <div id="catalog-sheet-sort" className="scroll-mt-group">
                <p className="market-label mb-snug text-muted-foreground">Sort</p>
                <CatalogSortControl fullWidth />
              </div>
              <CatalogPhoneRefineFields
                current={current}
                isPending={isPending}
                onToggleCondition={toggleCondition}
                onToggleSold={() => pushWith({ sold: current.includeSold ? null : '1' })}
                onToggleReserved={() =>
                  pushWith({ reserved: current.includeReserved ? null : '1' })
                }
                priceStops={priceStops}
                onPriceStopsChange={setPriceStops}
                onPriceCommit={commitPrices}
                priceLadder={priceLadder}
                topStop={topStop}
                ceilingCents={ceilingCents}
                histogram={facets.priceHistogram}
              />
            </div>
            {/* THE BUTTON SAYS WHAT IT WILL SHOW. "Done" closed the sheet without saying
                whether the filters had left anything to see; the live count answers
                that before the sheet closes, and Clear all sits beside it rather than
                as a link in the header. */}
            <SheetFooter className="flex-row gap-snug border-t border-border p-group">
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" onClick={clearFilters} disabled={isPending}>
                  Clear all
                </Button>
              ) : null}
              <SheetClose asChild>
                <Button type="button" className="flex-1" aria-busy={isPending}>
                  {result.total === 0
                    ? 'No listings match'
                    : `Show ${result.total} ${result.total === 1 ? 'listing' : 'listings'}`}
                </Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </MobileOnly>

      <DesktopOnly>
        {/* OPEN GROUPS, NOT DRILL-INS. Each filter was a row reading "Any >" that
            had to be opened to be used, so the rail hid every option behind a
            click and showed nothing of the stock. Now the boxes are on screen with
            how many listings each holds, and price is typed or dragged in place.
            A game pill is the one filter set outside the rail, so "Reset" beside
            "Filters" stays its way back; the applied chips above the grid are the
            other. */}
        <div id="catalog-filter-panel" className="mt-group bg-transparent">
          <div className="flex items-center justify-between px-cozy pb-tight">
            <span className="market-label text-muted-foreground">Filters</span>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                disabled={isPending}
                className="text-meta font-medium text-iris-ink hover:underline focus:outline-none focus-visible:underline disabled:opacity-50"
              >
                Reset
              </button>
            ) : null}
          </div>
          <CatalogRailGroups
            current={current}
            conditionCounts={facets.conditionCounts}
            isPending={isPending}
            onToggleCondition={toggleCondition}
            onToggleSold={() => pushWith({ sold: current.includeSold ? null : '1' })}
            onToggleReserved={() =>
              pushWith({ reserved: current.includeReserved ? null : '1' })
            }
            priceStops={priceStops}
            onPriceStopsChange={setPriceStops}
            onPriceCommit={commitPrices}
            priceLadder={priceLadder}
            topStop={topStop}
            ceilingCents={ceilingCents}
            histogram={facets.priceHistogram}
          />
        </div>
      </DesktopOnly>
    </div>
  );
}

/**
 * The desktop rail's filters as open groups: condition boxes with counts, the price
 * control in place, and the two availability toggles. Nothing is behind a disclosure;
 * on the catalog the rail holds only Marketplace and these, so it has the room.
 */
function CatalogRailGroups({
  current,
  conditionCounts,
  isPending,
  onToggleCondition,
  onToggleSold,
  onToggleReserved,
  priceStops,
  onPriceStopsChange,
  onPriceCommit,
  priceLadder,
  topStop,
  ceilingCents,
  histogram,
}: {
  current: Pick<
    CatalogFilterState,
    'conditions' | 'includeSold' | 'includeReserved'
  >;
  /** AVAILABLE listings per condition, from `CatalogFacets.conditionCounts`. */
  conditionCounts: Record<string, number>;
  isPending: boolean;
  onToggleCondition: (condition: string) => void;
  onToggleSold: () => void;
  onToggleReserved: () => void;
  priceStops: [number, number];
  onPriceStopsChange: (next: [number, number]) => void;
  onPriceCommit: (next: [number, number]) => void;
  priceLadder: number[];
  topStop: number;
  ceilingCents: number;
  /** See `CatalogFacets.priceHistogram`. Empty draws no histogram. */
  histogram: number[];
}) {
  return (
    <div className="flex flex-col gap-group px-tight">
      <fieldset>
        <legend className="mb-tight px-cozy text-body font-medium text-foreground">Condition</legend>
        <div className="flex flex-col">
          {ITEM_CONDITIONS.map((condition) => (
            <FilterCheckRow
              key={condition}
              label={condition}
              count={conditionCounts[condition] ?? 0}
              pressed={current.conditions.includes(condition)}
              onClick={() => onToggleCondition(condition)}
              disabled={isPending}
            />
          ))}
        </div>
      </fieldset>
      <div>
        <p className="mb-snug px-cozy text-body font-medium text-foreground">Price</p>
        <div className="px-cozy">
          <PriceRefineBlock
            priceStops={priceStops}
            onPriceStopsChange={onPriceStopsChange}
            onPriceCommit={onPriceCommit}
            priceLadder={priceLadder}
            topStop={topStop}
            ceilingCents={ceilingCents}
            histogram={histogram}
            disabled={isPending}
          />
        </div>
      </div>
      <fieldset>
        <legend className="mb-tight px-cozy text-body font-medium text-foreground">Showing</legend>
        <div className="flex flex-col">
          <FilterCheckRow
            label="Include reserved"
            pressed={current.includeReserved}
            onClick={onToggleReserved}
            disabled={isPending}
          />
          <FilterCheckRow
            label="Include sold"
            pressed={current.includeSold}
            onClick={onToggleSold}
            disabled={isPending}
          />
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The phone refine fields, flat inside the bottom sheet. Kept deliberately
 * flat — the sheet has the vertical room the rail does not, and the sheet is
 * also the only place a phone can reach sort, so sort leads here.
 */
function CatalogPhoneRefineFields({
  current,
  isPending,
  onToggleCondition,
  onToggleSold,
  onToggleReserved,
  priceStops,
  onPriceStopsChange,
  onPriceCommit,
  priceLadder,
  topStop,
  ceilingCents,
  histogram,
}: {
  current: Pick<
    CatalogFilterState,
    'conditions' | 'includeSold' | 'includeReserved'
  >;
  isPending: boolean;
  onToggleCondition: (condition: string) => void;
  onToggleSold: () => void;
  onToggleReserved: () => void;
  priceStops: [number, number];
  onPriceStopsChange: (next: [number, number]) => void;
  onPriceCommit: (next: [number, number]) => void;
  priceLadder: number[];
  topStop: number;
  ceilingCents: number;
  /**
   * Relative listing density per ladder segment, from `CatalogFacets.priceHistogram`.
   * Empty renders no histogram at all rather than a flat bar, so a catalog with no
   * prices does not imply a uniform spread.
   */
  histogram: number[];
}) {
  return (
    <>
      {/* The rule sits on a wrapper, not the fieldset: a fieldset's top border runs
          through its legend, which drew this one heading as "CONDITION ——" beside
          siblings whose rule sits above the label. */}
      <div id="catalog-sheet-condition" className="scroll-mt-group border-t border-border pt-group">
        <fieldset>
          <legend className="market-label mb-snug text-muted-foreground">Condition</legend>
          <div className="flex flex-wrap gap-1.5">
            {ITEM_CONDITIONS.map((condition) => (
              <FilterSquare
                key={condition}
                label={condition}
                pressed={current.conditions.includes(condition)}
                onClick={() => onToggleCondition(condition)}
                disabled={isPending}
              />
            ))}
          </div>
        </fieldset>
      </div>

      <div id="catalog-sheet-price" className="scroll-mt-group border-t border-border pt-group">
        <p className="market-label mb-snug text-muted-foreground">Price</p>
        <PriceRefineBlock
          priceStops={priceStops}
          onPriceStopsChange={onPriceStopsChange}
          onPriceCommit={onPriceCommit}
          priceLadder={priceLadder}
          topStop={topStop}
          ceilingCents={ceilingCents}
          histogram={histogram}
          disabled={isPending}
        />
      </div>

      {/* TWO INDEPENDENT TOGGLES, not one "show unavailable". They answer
          different questions and a buyer wants them separately.

          Reserved leads because it is the one you might still get. It is a live
          contract that has not landed — no buying, trading, or offering, every
          one of those guards on AVAILABLE — but it is not terminal either: a
          failed trade restores its items, as does a failed collateral hold. So
          the reason to surface one is to save it and hear if it frees up.

          Sold is settled history, and is there for a different job: pricing a
          card against what comparable ones actually went for. Folding the two
          into a single control would imply the states mean the same thing. */}
      <div className="border-t border-border pt-group">
        <p className="market-label mb-snug text-muted-foreground">Availability</p>
        <div className="flex flex-wrap gap-1.5">
          <FilterSquare
            label="Include reserved"
            pressed={current.includeReserved}
            onClick={onToggleReserved}
            disabled={isPending}
          />
          <FilterSquare
            label="Include sold"
            pressed={current.includeSold}
            onClick={onToggleSold}
            disabled={isPending}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The price control shared by the rail row and the phone sheet: the density the
 * stock sits in, above the control that filters it. A range slider tells a
 * member what they CAN ask for and nothing about what asking would return — so
 * the common failure is dragging into an empty band and reading the empty grid
 * as a broken filter. `aria-hidden` on the histogram because it is a summary of
 * the result count, which the results header states in words.
 */
function PriceRefineBlock({
  priceStops,
  onPriceStopsChange,
  onPriceCommit,
  priceLadder,
  topStop,
  ceilingCents,
  histogram,
  disabled,
}: {
  priceStops: [number, number];
  onPriceStopsChange: (next: [number, number]) => void;
  onPriceCommit: (next: [number, number]) => void;
  priceLadder: number[];
  topStop: number;
  ceilingCents: number;
  histogram: number[];
  disabled: boolean;
}) {
  return (
    <>
      <PriceHistogram
        buckets={histogram}
        stops={priceStops}
        segments={Math.max(priceLadder.length - 1, 0)}
      />
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
        className="px-tight py-snug"
      />
      <div
        className="mt-tight flex justify-between text-meta text-muted-foreground tabular-nums"
        aria-hidden="true"
      >
        <span>{AUD_WHOLE_FORMATTER.format(0)}</span>
        <span>{AUD_WHOLE_FORMATTER.format(ceilingCents / 100)}+</span>
      </div>

      {/* TYPED BOUNDS, BESIDE THE LADDER RATHER THAN INSTEAD OF IT.

          The ladder is the right mechanic — each drag stays proportionate to the price
          it lands on — but it has exactly the stops it has, so a member who wants $500
          when the nearest stop is $400 has no way to say so. These commit to the same
          URL params the thumbs write, and `nearestPriceStop` snaps the thumbs to
          follow, so the two controls stay one filter rather than becoming two. */}
      <PriceBoundsFields
        ladder={priceLadder}
        stops={priceStops}
        topStop={topStop}
        disabled={disabled}
        onCommit={onPriceCommit}
      />
    </>
  );
}

function FilterCheckRow({
  label,
  count,
  pressed,
  onClick,
  disabled,
}: {
  label: string;
  /** Listings this option holds, shown at the right edge when given. */
  count?: number;
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
        'flex w-full items-center gap-cozy rounded-lg px-cozy py-1.5 text-left text-body transition-colors border border-transparent focus:outline-none focus-visible:border-iris disabled:opacity-60',
        // No violet wash behind a ticked row. The box IS the state — it is the
        // thing that changes shape when you click — and tinting the whole row
        // as well put a second, much larger violet element in the rail for the
        // same one bit of information.
        pressed
          ? 'font-semibold text-foreground'
          : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
      )}
    >
      {/* AN EMPTY BOX, NOT A DOT. The unchecked state used to be a 6px circle at
          50% alpha — 2.18:1, and the visual vocabulary of a list bullet rather
          than a control, so the largest block in the filter rail did not read as
          interactive at all. A square outline is the one shape users already
          know means "you can tick this". */}
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors',
          // Ink, not violet, so the whole panel speaks one language: a chosen
          // thing goes near-black, whether it is a chip or a tickbox. That
          // leaves the price slider as the only violet left down here, which is
          // the one control the colour is actually reserved for.
          pressed
            ? 'border-foreground bg-foreground text-primary-foreground'
            : 'border-input bg-card',
        )}
        aria-hidden="true"
      >
        {pressed ? <HugeiconsIcon icon={CheckIcon} className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 text-meta font-normal tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </button>
  );
}

function FilterSquare({
  label,
  pressed,
  onClick,
  disabled = false,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-9 min-h-9 items-center rounded-md border px-2.5 text-meta font-semibold tracking-tight transition-colors focus:outline-none focus-visible:border-iris disabled:opacity-60',
        // Selected inverts to near-black, the same treatment the genre pills
        // above the grid already use for exactly this — a chosen filter chip.
        // It was a violet border over a violet wash with violet text, three
        // uses of the hue on one 9px-tall control.
        pressed
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-input bg-card text-muted-foreground hover:border-foreground/60 hover:text-foreground',
      )}
    >
      {label}
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

  // No leading glyph. A sliders icon sat here, decorative and `aria-hidden`,
  // and it was the wrong sign for the control it labelled — faders mean FILTER
  // everywhere else in this app, including the phone chrome's filter trigger,
  // and this is the sort select. The trigger already names itself.
  return (
    <Select
      value={current.sort}
      onValueChange={(value) => pushWith({ sort: value === 'newest' ? null : value })}
    >
      <SelectTrigger
        className={cn('text-body', fullWidth ? 'h-9 w-full' : 'h-9 w-full min-w-0 sm:w-[190px]')}
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
  );
}

/** Cents to the readable dollar string the catalog URL carries. */
function dollarsParam(cents: number): string {
  return String(Math.round(cents) / 100);
}

/* `niceCeilingCents`, `buildPriceLadderCents` and `nearestPriceStop` moved to
   `lib/catalog/priceLadder.ts` so the facets query can bucket the histogram against the
   same stops the thumbs snap to. See the note at the top of that file. */

/**
 * Listing density per ladder segment, drawn above the range slider.
 *
 * DELIBERATELY NOT INTERACTIVE. It would be easy to make a bar click-to-select, and the
 * reason not to is that a bar spans a SEGMENT while a thumb sits on a STOP — so a click
 * has to guess whether the member meant the segment's lower or upper bound. The slider
 * already expresses that unambiguously. This is a read.
 *
 * Bars inside the selected range are drawn at full strength and the rest recede, so the
 * control shows both where the stock is and how much of it the current range covers.
 */
function PriceHistogram({
  buckets,
  stops,
  segments,
}: {
  buckets: number[];
  stops: [number, number];
  segments: number;
}) {
  // No data means no histogram. A flat row of minimum-height bars would read as "the
  // stock is evenly spread", which is a claim we cannot make from an empty catalog.
  if (buckets.length === 0 || segments === 0) return null;

  const [minStop, maxStop] = stops;

  return (
    // INSET BY HALF A THUMB, so a bar boundary lands on the value the thumb would snap
    // to. Radix positions a thumb by its CENTRE, so the slider's 0% is half a thumb in
    // from the left edge of the control and 100% is half a thumb in from the right —
    // the thumbs overhang the value range they describe. The histogram was `px-tight`
    // (4px) against a `size-6` (24px) thumb, so measured against the live page every
    // bar sat 8px left of the range it was drawing and the whole row was 16px wider
    // than the scale underneath it. The first bar claimed to cover prices below the
    // minimum the slider can express.
    //
    // The two values track the thumb: `size-5` on a phone, `size-6` from `md`.
    <div
      className="flex h-8 items-end gap-px px-2.5 md:px-cozy"
      aria-hidden="true"
    >
      {buckets.map((share, segment) => {
        // A segment is in range when the selection covers any part of it. The upper
        // thumb sits ON a stop, so segment `maxStop - 1` is the last one included.
        const inRange = segment >= minStop && segment < Math.max(maxStop, minStop + 1);
        return (
          <span
            key={segment}
            // A floor of 8% for an OCCUPIED segment, so one listing is still visibly
            // different from none. An EMPTY segment draws nothing: the 2% floor it used
            // to carry, with `gap-px` between bars, rendered as a dotted line along the
            // track that read as a broken border rather than as "no stock here".
            style={{ height: share > 0 ? `${Math.max(share * 100, 8)}%` : 0 }}
            className={cn(
              'min-w-0 flex-1 rounded-t-[2px] transition-colors',
              inRange ? 'bg-foreground/60' : 'bg-foreground/15',
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * Typed minimum and maximum, committing to the same URL params as the thumbs.
 *
 * Local state while focused, committed on blur or Enter — not on every keystroke, which
 * would fire a catalog fetch per digit and fight the member as they type "1500".
 */
function PriceBoundsFields({
  ladder,
  stops,
  topStop,
  disabled,
  onCommit,
}: {
  ladder: number[];
  stops: [number, number];
  topStop: number;
  disabled: boolean;
  onCommit: (next: [number, number]) => void;
}) {
  const [minStop, maxStop] = stops;
  const openEnded = maxStop >= topStop;

  // Mirrors the committed stops whenever they change from outside — a drag, a reset, a
  // shared URL — so the fields never disagree with the thumbs.
  const [draft, setDraft] = useState<{ min: string; max: string }>({ min: '', max: '' });
  useEffect(() => {
    setDraft({
      min: minStop > 0 ? String(Math.round(ladder[minStop] / 100)) : '',
      max: openEnded ? '' : String(Math.round(ladder[maxStop] / 100)),
    });
  }, [ladder, minStop, maxStop, openEnded]);

  /** Snap a typed dollar amount onto the ladder and commit both thumbs. */
  function commit(next: { min: string; max: string }) {
    const minDollars = Number(next.min);
    const maxDollars = Number(next.max);

    const nextMin =
      next.min.trim() === '' || !Number.isFinite(minDollars) || minDollars <= 0
        ? 0
        : nearestPriceStop(ladder, minDollars * 100);
    const nextMax =
      next.max.trim() === '' || !Number.isFinite(maxDollars) || maxDollars <= 0
        ? topStop
        : nearestPriceStop(ladder, maxDollars * 100);

    // A member who types a minimum above their maximum means to move the bound they
    // just touched, not to produce an empty range — so the pair is ordered rather than
    // rejected. Rejecting would leave the field showing a value that is not filtering.
    onCommit(nextMin <= nextMax ? [nextMin, nextMax] : [nextMax, nextMin]);
  }

  return (
    <div className="mt-cozy flex items-center gap-snug">
      <Input
        type="text"
        inputMode="numeric"
        value={draft.min}
        disabled={disabled}
        aria-label="Minimum price in dollars"
        placeholder="Min"
        onChange={(event) => setDraft((d) => ({ ...d, min: event.target.value }))}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          }
        }}
        className="h-8 min-w-0 flex-1 px-snug text-meta tabular-nums"
      />
      <span className="text-meta text-muted-foreground">to</span>
      <Input
        type="text"
        inputMode="numeric"
        value={draft.max}
        disabled={disabled}
        aria-label="Maximum price in dollars"
        placeholder="Any"
        onChange={(event) => setDraft((d) => ({ ...d, max: event.target.value }))}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          }
        }}
        className="h-8 min-w-0 flex-1 px-snug text-meta tabular-nums"
      />
    </div>
  );
}

/** The price a single thumb stands for, spoken form included. */
function priceStopLabel(ladder: number[], stop: number, topStop: number): string {
  const price = AUD_WHOLE_FORMATTER.format(ladder[stop] / 100);
  return stop >= topStop ? `${price} or more` : price;
}
