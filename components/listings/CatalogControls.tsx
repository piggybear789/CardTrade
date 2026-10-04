'use client';

// Marketplace refine rail. After first paint, pills / sort / price / condition
// call CatalogView.apply — fetch in place, rewrite the URL, do not navigate.
// Prices stay readable dollars in the URL and integer cents at the action.

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  ChevronRightIcon,
  GemIcon,
  HotPriceIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

import { DesktopOnly, MobileOnly } from '@/components/layout/Breakpoint';
import { subscribeCatalogFilters } from '@/lib/catalog/browseEvents';
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
  newest: 'Recently Listed',
  'price-asc': 'Price: Low to High',
  'price-desc': 'Price: High to Low',
  rating: 'Seller Rating: High to Low',
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

/** Plain-language summary of the selected price range, for a property-row value. */
function priceSummary(
  ladder: number[],
  [minStop, maxStop]: [number, number],
  topStop: number,
): string {
  const openEnded = maxStop >= topStop;
  if (minStop <= 0 && openEnded) return 'Any';
  const from = AUD_WHOLE_FORMATTER.format(ladder[minStop] / 100);
  if (openEnded) return `${from}+`;
  return `${from} – ${AUD_WHOLE_FORMATTER.format(ladder[maxStop] / 100)}`;
}

/** Plain-language summary of the availability toggles, for a property-row value. */
/**
 * Plain-language summary of the availability toggles.
 *
 * Each active toggle is named in full: at ~230px of rail a combined label
 * ("+ Reserved, sold") is only a couple of words shorter than the plain list,
 * and truncation mid-label ("+ Reserve…") would land on the common case rather
 * than on a long-tail one.
 */
function availabilitySummary(includeReserved: boolean, includeSold: boolean): string {
  const parts: string[] = [];
  if (includeReserved) parts.push('Reserved');
  if (includeSold) parts.push('sold');
  return parts.length > 0 ? `Including ${parts.join(' + ')}` : 'Available';
}

/** Browse updates stay on the client — see CatalogViewProvider. */
function useCatalogNav() {
  const { apply, reset, isPending } = useCatalogView();
  return { isPending, pushWith: apply, reset };
}

/** Marketplace filter rail. Phone: bottom sheet. Desktop: in-page rows. */
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
    window.history.replaceState(window.history.state, '', qs ? `/?${qs}` : '/');
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
              <div className="flex items-start justify-between gap-cozy pr-10">
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
                    className="shrink-0 rounded-sm pt-0.5 text-body font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-iris/60 disabled:opacity-50"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
            </SheetHeader>
            <div className="space-y-group overflow-y-auto overscroll-contain px-5 py-group">
              {/* Sort belongs to the sheet, not to the shared refine fields.
                  On desktop it sits beside the result count in the catalog
                  header, where the thing being ordered is on screen; the sheet
                  is the only place a phone can reach it, so it leads here. */}
              <div>
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
            <SheetFooter className="border-t border-border p-group">
              <SheetClose asChild>
                <Button type="button" size="sm">
                  Done
                </Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </MobileOnly>

      <DesktopOnly>
        {/* No heading and no chrome of its own — the rail's h1 already says
            Marketplace. What the rail does say is one row per filter with its
            current value, opening inline: "Condition · Near Mint, Lightly
            Played" and "Price · $100 – $500". A game pill is the one filter that
            is set outside the rail, so the "Reset" beside "Filters" is its only
            way back — without it, picking a game leaves a filter nothing on
            this page can undo. */}
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
          <CatalogPropertyRows
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
      </DesktopOnly>
    </div>
  );
}

type CatalogPropertyKey = 'condition' | 'price' | 'showing';

/**
 * The desktop rail as property rows: one row per filter that states its value
 * and opens inline, so the whole search reads in three rows. Only one is open
 * at a time — there is a single disclosure's worth of room on a laptop rail.
 *
 * Closed unless the URL already carries the row's filter: a shared or bookmarked
 * filtered link must never hide the filter it is applying. After mount the state
 * belongs to the member — the rows do not close when a filter is set inside one,
 * because closing on select would hide the result of the tap that just happened.
 */
function CatalogPropertyRows({
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
  const [open, setOpen] = useState<CatalogPropertyKey | null>(() =>
    current.conditions.length > 0
      ? 'condition'
      : priceStopsActive(priceStops, topStop)
        ? 'price'
        : current.includeSold || current.includeReserved
          ? 'showing'
          : null,
  );

  function toggle(key: CatalogPropertyKey) {
    setOpen((value) => (value === key ? null : key));
  }

  const priceRangeLabel = priceSummary(priceLadder, priceStops, topStop);
  const showingLabel = availabilitySummary(current.includeSold, current.includeReserved);

  return (
    <div className="flex flex-col gap-0.5">
      <CatalogPropertyRow
        label="Condition"
        value={conditionSummary(current.conditions)}
        active={current.conditions.length > 0}
        open={open === 'condition'}
        onClick={() => toggle('condition')}
        icon={GemIcon}
      >
        <div className="flex flex-col gap-tight">
          {ITEM_CONDITIONS.map((condition) => (
            <FilterCheckRow
              key={condition}
              label={condition}
              pressed={current.conditions.includes(condition)}
              onClick={() => onToggleCondition(condition)}
              disabled={isPending}
            />
          ))}
        </div>
      </CatalogPropertyRow>
      <CatalogPropertyRow
        label="Price"
        value={priceRangeLabel}
        active={priceStopsActive(priceStops, topStop)}
        open={open === 'price'}
        onClick={() => toggle('price')}
        icon={HotPriceIcon}
      >
        <div className="border-t border-border pt-group">
          <div className="mb-cozy text-body font-semibold tabular-nums">{priceRangeLabel}</div>
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
      </CatalogPropertyRow>
      <CatalogPropertyRow
        label="Showing"
        value={showingLabel}
        active={current.includeSold || current.includeReserved}
        open={open === 'showing'}
        onClick={() => toggle('showing')}
        icon={SparklesIcon}
      >
        <div className="flex flex-col gap-tight">
          <FilterCheckRow
            label="Include reserved listings"
            pressed={current.includeReserved}
            onClick={onToggleReserved}
            disabled={isPending}
          />
          <FilterCheckRow
            label="Include sold listings"
            pressed={current.includeSold}
            onClick={onToggleSold}
            disabled={isPending}
          />
        </div>
      </CatalogPropertyRow>
    </div>
  );
}

function priceStopsActive([minStop, maxStop]: [number, number], topStop: number): boolean {
  return minStop > 0 || maxStop < topStop;
}

/**
 * One filter as a row: an icon, the filter's name, and on the right the value
 * it currently carries. Opening is a native `button`; the accordion primitive is
 * for stacked labeled sections, not for rows whose open state is mutually exclusive.
 */
function CatalogPropertyRow({
  label,
  value,
  active,
  open,
  onClick,
  icon,
  children,
}: {
  label: string;
  value: string;
  /** Whether the row's filter is currently narrowing the grid. */
  active: boolean;
  open: boolean;
  onClick: () => void;
  icon: typeof GemIcon;
  children: ReactNode;
}) {
  const Icon = icon;
  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        open ? 'border-border bg-card' : 'border-transparent',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        className="flex h-10 w-full items-center gap-snug px-cozy text-left border border-transparent focus:outline-none focus-visible:border-iris/60 rounded-lg"
      >
        <HugeiconsIcon icon={Icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-body text-muted-foreground">{label}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-right text-body tabular-nums',
            active ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {value}
        </span>
        <HugeiconsIcon
          icon={ChevronRightIcon}
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="px-cozy pb-cozy pt-tight">{children}</div> : null}
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
      <fieldset className="border-t border-border pt-group">
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
        'flex w-full items-center gap-cozy rounded-lg px-cozy py-snug text-left text-body transition-colors border border-transparent focus:outline-none focus-visible:border-iris/60 disabled:opacity-60',
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
        'inline-flex h-9 min-h-9 items-center rounded-md border px-2.5 text-meta font-semibold tracking-tight transition-colors focus:outline-none focus-visible:border-iris/60 disabled:opacity-60',
        // Selected inverts to near-black, the same treatment the genre pills
        // above the grid already use for exactly this — a chosen filter chip.
        // It was a violet border over a violet wash with violet text, three
        // uses of the hue on one 9px-tall control.
        pressed
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-input bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
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
