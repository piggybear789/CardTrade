'use client';

// URL-driven controls for the server-rendered marketplace (Req 3.8, Phase 7).
// Filters update search params, reset pagination, and preserve server ownership of
// catalog querying. Prices remain readable dollars in the URL and integer cents
// at the action boundary.

import { useCallback, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  Check,
  ChevronRight,
  CircleDollarSign,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { CatalogSort } from '@/lib/actions/listings';

const SORT_LABELS: Record<CatalogSort, string> = {
  newest: 'Recently Listed',
  'price-asc': 'Price: Low to High',
  'price-desc': 'Price: High to Low',
  rating: 'Seller Rating: High to Low',
};

const AUD_FORMATTER = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 2,
});

/** Current URL-backed catalog filter values. */
export interface CatalogFilterState {
  q: string;
  categories: string[];
  condition: string;
  /** Dollar strings suitable for filter inputs; empty when unset. */
  min: string;
  max: string;
  /** Restrict to items whose seller has a VERIFIED KYC_Status. */
  verifiedOnly: boolean;
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
  facets: { categories: string[]; conditions: string[] };
  current: CatalogFilterState;
}
/** Marketplace navigation and filter rail, collapsed into a disclosure on mobile. */
export function CatalogFilters({ facets, current }: CatalogFiltersProps) {
  const { isPending, pushWith, reset } = useCatalogNav();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minPrice, setMinPrice] = useState(current.min);
  const [maxPrice, setMaxPrice] = useState(current.max);

  useEffect(() => setMinPrice(current.min), [current.min]);
  useEffect(() => setMaxPrice(current.max), [current.max]);

  const hasActiveFilters =
    current.q !== '' ||
    current.categories.length > 0 ||
    current.condition !== '' ||
    current.min !== '' ||
    current.max !== '' ||
    current.verifiedOnly;

  function toggleCategory(category: string) {
    const next = current.categories.includes(category)
      ? current.categories.filter((value) => value !== category)
      : [...current.categories, category];
    pushWith({ category: next });
  }

  function commitPrices(nextMin: string, nextMax: string) {
    pushWith({
      min: sanitizeDollars(nextMin),
      max: sanitizeDollars(nextMax),
    });
  }

  function clearFilters() {
    setMinPrice('');
    setMaxPrice('');
    reset();
  }

  function toggleVerifiedOnly() {
    pushWith({ verified: current.verifiedOnly ? null : '1' });
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
      <div className="flex items-center justify-between py-4 lg:hidden">
        <Button
          variant="outline"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="catalog-filter-panel"
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {hasActiveFilters ? (
            <span className="flex size-5 items-center justify-center rounded-full border border-gold/40 bg-gold/20 text-[0.6875rem] font-semibold text-foreground">
              {current.categories.length +
                Number(Boolean(current.condition)) +
                Number(Boolean(current.min || current.max)) +
                Number(Boolean(current.q)) +
                Number(current.verifiedOnly)}
            </span>
          ) : null}
        </Button>
        {hasActiveFilters ? (
          <Button variant="ghost" onClick={clearFilters} disabled={isPending}>
            Clear All
          </Button>
        ) : null}
      </div>

      <div
        id="catalog-filter-panel"
        className={cn(
          'mb-5 space-y-5 rounded-xl border border-border/70 bg-card p-4 shadow-market lg:mb-0 lg:mt-4 lg:block lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-t lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-4 lg:shadow-none',
          filtersOpen ? 'block' : 'hidden',
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
          <fieldset>
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

        <div className="border-t border-border/70 pt-5">
          <p className="market-label mb-2 text-muted-foreground">Price in AUD</p>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <CircleDollarSign className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="min-price" className="sr-only">Minimum Price</Label>
              <Input
                id="min-price"
                name="min-price"
                type="number"
                inputMode="decimal"
                autoComplete="off"
                min="0"
                placeholder="Min…"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                onBlur={() => commitPrices(minPrice, maxPrice)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitPrices(minPrice, maxPrice);
                }}
                className="pl-8"
              />
            </div>
            <span className="text-muted-foreground" aria-hidden="true">–</span>
            <div className="relative min-w-0 flex-1">
              <Label htmlFor="max-price" className="sr-only">Maximum Price</Label>
              <Input
                id="max-price"
                name="max-price"
                type="number"
                inputMode="decimal"
                autoComplete="off"
                min="0"
                placeholder="Max…"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                onBlur={() => commitPrices(minPrice, maxPrice)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitPrices(minPrice, maxPrice);
                }}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border/70 pt-5">
          <p className="market-label mb-2 text-muted-foreground">Seller</p>
          <button
            type="button"
            onClick={toggleVerifiedOnly}
            disabled={isPending}
            aria-pressed={current.verifiedOnly}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 lg:py-2.5',
              current.verifiedOnly
                ? 'bg-gold/10 font-semibold text-foreground'
                : 'text-foreground/85 hover:bg-muted/70 hover:text-foreground',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              {current.verifiedOnly ? (
                <Check className="size-4 text-gold" />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              Verified sellers only
              <BadgeCheck className="size-3.5 text-gold" aria-hidden="true" />
            </span>
          </button>
        </div>

        {facets.conditions.length > 0 ? (
          <div className="border-t border-border/70 pt-5">
            <Label htmlFor="catalog-condition" className="market-label mb-2 block text-muted-foreground">
              Condition
            </Label>
            <Select
              value={current.condition === '' ? 'all' : current.condition}
              onValueChange={(value) => pushWith({ condition: value === 'all' ? null : value })}
            >
              <SelectTrigger id="catalog-condition" aria-label="Filter by condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Condition</SelectItem>
                {facets.conditions.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
    Boolean(current.condition) ||
    Boolean(current.min) ||
    Boolean(current.max) ||
    current.verifiedOnly;

  if (!hasFilters) return null;

  const priceLabel = current.min && current.max
    ? `${AUD_FORMATTER.format(Number(current.min))}–${AUD_FORMATTER.format(Number(current.max))}`
    : current.min
      ? `From ${AUD_FORMATTER.format(Number(current.min))}`
      : `Up to ${AUD_FORMATTER.format(Number(current.max))}`;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
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
      {current.condition ? (
        <FilterChip label={current.condition} onRemove={() => pushWith({ condition: null })} disabled={isPending} />
      ) : null}
      {current.min || current.max ? (
        <FilterChip
          label={priceLabel}
          onRemove={() => pushWith({ min: null, max: null })}
          disabled={isPending}
        />
      ) : null}
      {current.verifiedOnly ? (
        <FilterChip
          label="Verified sellers only"
          onRemove={() => pushWith({ verified: null })}
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

/** Normalize a dollar input to a clean URL value. */
function sanitizeDollars(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const number = Number(trimmed);
  if (!Number.isFinite(number) || number < 0) return null;
  return String(number);
}
