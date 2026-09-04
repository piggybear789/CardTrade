'use client';

// Marketplace refine rail. After first paint, pills / sort / price / condition
// call CatalogView.apply — fetch in place, rewrite the URL, do not navigate.
// Prices stay readable dollars in the URL and integer cents at the action.

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, Search01Icon, XIcon } from '@hugeicons/core-free-icons';

import { DesktopOnly, MobileOnly } from '@/components/layout/Breakpoint';
import { subscribeCatalogFilters } from '@/lib/catalog/browseEvents';

import { useCatalogView } from '@/components/listings/CatalogView';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
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
  /** Include items under an active contract. Independent of {@link includeSold}. */
  includeReserved: boolean;
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
    // Width comes from the container now. The old `sm:w-56` was sized for a
    // toolbar slot and would overflow the rail, whose content box is narrower
    // than 224px at its minimum width.
    <form role="search" onSubmit={handleSubmit} className="relative w-full min-w-0">
      <HugeiconsIcon icon={Search01Icon}
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
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground border border-transparent focus:outline-none focus-visible:border-iris"
        >
          <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
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

  // `categories` belongs in here. Without it, picking a game pill produced no
  // "Clear all" anywhere on the page — four of five filter types were
  // reversible and the most prominent one was not, even though `reset()` would
  // have cleared it if anything had offered to.
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
                    className="shrink-0 rounded-sm pt-0.5 text-body font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-iris disabled:opacity-50"
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
                <p className="market-label mb-2 text-muted-foreground">Sort</p>
                <CatalogSortControl fullWidth />
              </div>
              <CatalogRefineFields
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
                choiceStyle="squares"
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
        {/* No heading and no chrome of its own. "Refine results" titled a panel
            that had nothing to be distinguished from — the rail's h1 already
            says Marketplace and every block below carries its own label — and
            it cost 25px of a rail that did not have 25px to spare. Each block
            brings its own `border-t`, so a border here as well would draw two
            rules a hair apart.

            No "Clear all" either. Every filter in the rail reverses where it
            was set: chips toggle off, the slider drags back, the checkbox
            unticks. A bulk reset is still one click away on the one screen that
            needs it — the empty state offers "Clear Filters" when a search
            returns nothing, which is the case where undoing filters one at a
            time is genuinely tedious. */}
        <div id="catalog-filter-panel" className="mt-4 space-y-5 bg-transparent">
          {hasActiveFilters ? (
            <div className="flex items-center justify-between">
              <span className="text-meta text-muted-foreground">Active filters</span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-meta font-medium text-iris-ink hover:underline focus:outline-none focus-visible:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}
          <CatalogFilterSearch />
          <CatalogRefineFields
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
            choiceStyle="list"
            collapsibleCondition
          />
        </div>
      </DesktopOnly>
    </div>
  );
}

function CatalogRefineFields({
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
  choiceStyle,
  collapsibleCondition = false,
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
  choiceStyle: 'squares' | 'list';
  /**
   * Put Condition behind a disclosure, closed unless it is already filtering.
   *
   * For the rail only. Seven stacked rows measured 348px — a third of the whole
   * rail, and enough on its own to push the price slider off a 1366x768 screen.
   * The sheet has the room and its chips are half the height, so it stays flat.
   */
  collapsibleCondition?: boolean;
}) {
  // CHIPS EVERYWHERE, INCLUDING THE RAIL. Condition used to render as seven
  // full-width checkbox rows on desktop: 40px each, 348px in total, and the
  // single largest block in a rail with a 703px ceiling. Wrapping chips carry
  // the same seven `aria-pressed` toggles in three rows of ~120px, which is what
  // lets the section open without pushing the price slider off a laptop screen.
  //
  // Width is the real argument. The rail gives these ~225px, and a full-width
  // row spends all of it on one short label; the sheet reached the same answer
  // for the same reason.
  const conditionRows = (
    <div className="flex flex-wrap gap-1.5">
      {CONDITION_OPTIONS.map((condition) => (
        <FilterSquare
          key={condition}
          label={condition}
          pressed={current.conditions.includes(condition)}
          onClick={() => onToggleCondition(condition)}
          disabled={isPending}
        />
      ))}
    </div>
  );

  return (
    <>
      {collapsibleCondition ? (
        <ConditionDisclosure selectedCount={current.conditions.length}>
          {conditionRows}
        </ConditionDisclosure>
      ) : (
        <fieldset className="border-t border-border pt-group">
          <legend className="market-label mb-2 text-muted-foreground">Condition</legend>
          {conditionRows}
        </fieldset>
      )}

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
        <p className="market-label mb-2 text-muted-foreground">Availability</p>
        {choiceStyle === 'squares' ? (
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
        ) : (
          <div className="space-y-tight">
            <FilterCheckRow
              label="Include reserved items"
              pressed={current.includeReserved}
              onClick={onToggleReserved}
              disabled={isPending}
            />
            <FilterCheckRow
              label="Include sold items"
              pressed={current.includeSold}
              onClick={onToggleSold}
              disabled={isPending}
            />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Condition behind a disclosure, for the rail.
 *
 * Closed by default, but open on mount when the URL already carries
 * `?condition=` — a shared or bookmarked filtered link must never hide the
 * filter it is applying. After mount the state belongs to the user: selecting
 * or clearing conditions does not force it back open, and the count on the
 * trigger keeps a collapsed section from ever filtering silently.
 */
function ConditionDisclosure({
  selectedCount,
  children,
}: {
  selectedCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => (selectedCount > 0 ? 'condition' : ''));

  return (
    <Accordion
      type="single"
      collapsible
      value={open}
      onValueChange={setOpen}
      className="border-t border-border pt-2"
    >
      {/* `border-b-0`: the next block draws the rule below this one, the same
          way every other block in the panel separates itself with a top border. */}
      <AccordionItem value="condition" className="border-b-0">
        <AccordionTrigger headingAs="div" className="group py-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="market-label text-muted-foreground transition-colors group-hover:text-foreground">
              Condition
            </span>
            {selectedCount > 0 ? (
              <>
                <Badge
                  className="border-foreground bg-foreground px-1.5 py-0 tabular-nums text-primary-foreground"
                  aria-hidden="true"
                >
                  {selectedCount}
                </Badge>
                {/* The badge alone would read as a bare "2" appended to the
                    label. Spelling it out makes the trigger announce
                    "Condition, 2 selected". */}
                <span className="sr-only">({selectedCount} selected)</span>
              </>
            ) : null}
          </span>
        </AccordionTrigger>
        {/* No max-height and no inner scroll. As chips the seven options are
            ~120px, so the section opens inside the rail's budget on a 1366x768
            laptop with room to spare. A capped, internally scrolling list was
            the alternative and it was worse: it showed three of seven with no
            visible scrollbar, which is the same silent clip this change set
            exists to remove, just moved one container inwards. */}
        <AccordionContent className="pb-cozy pt-1">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
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
        'flex w-full items-center gap-cozy rounded-lg px-cozy py-snug text-left text-body transition-colors border border-transparent focus:outline-none focus-visible:border-iris disabled:opacity-60',
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
        'inline-flex h-9 min-h-9 items-center rounded-md border px-2.5 text-meta font-semibold tracking-tight transition-colors focus:outline-none focus-visible:border-iris disabled:opacity-60',
        // Selected inverts to near-black, the same treatment the genre pills
        // above the grid already use for exactly this — a chosen filter chip.
        // It was a violet border over a violet wash with violet text, three
        // uses of the hue on one 9px-tall control.
        pressed
          ? 'border-foreground bg-foreground text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground',
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
