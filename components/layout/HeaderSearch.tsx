'use client';

// Site-wide jump search. Finds a listing from anywhere: typeahead opens the
// card, Enter starts a marketplace query. Already on `/listings`, that query
// is applied in place so the page is not remounted. It does not live-filter
// the grid — that is `CatalogFilterSearch`. Phone chrome uses `appearance="pill"`.

import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { suggestCatalogItems, type CatalogSuggestion } from '@/lib/actions/listings';
import { requestCatalogBrowse, subscribeCatalogQuery } from '@/lib/catalog/browseEvents';
import { Input } from '@/components/ui/input';
import { formatMoney, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

const PLACEHOLDER = 'Search a card, set, or player…';
const SUGGEST_MIN = 2;
const DEBOUNCE_MS = 280;

let slashUsers = 0;
let slashCleanup: (() => void) | null = null;

function retainSlashListener() {
  slashUsers += 1;
  if (slashUsers === 1) {
    function onSlash(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      const selectors = ['input[data-market-search]', 'input[data-catalog-filter]'];
      for (const selector of selectors) {
        const candidates = document.querySelectorAll<HTMLInputElement>(selector);
        for (const field of candidates) {
          if (field.disabled || field.getClientRects().length === 0) continue;
          event.preventDefault();
          field.focus();
          field.select();
          return;
        }
      }
    }
    window.addEventListener('keydown', onSlash);
    slashCleanup = () => window.removeEventListener('keydown', onSlash);
  }
  return () => {
    slashUsers -= 1;
    if (slashUsers === 0) {
      slashCleanup?.();
      slashCleanup = null;
    }
  };
}

function HeaderSearchFallback({
  className,
  ariaLabel,
  placeholder = PLACEHOLDER,
  appearance = 'default',
}: {
  className?: string;
  ariaLabel: string;
  placeholder?: string;
  appearance?: HeaderSearchAppearance;
}) {
  return (
    <div role="search" className={cn('relative w-full', className)}>
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2',
          appearance === 'pill' ? 'left-2.5 size-3' : 'left-3 size-4',
          appearance === 'default' ? 'text-parchment' : 'text-foreground',
        )}
        strokeWidth={appearance === 'default' ? 2 : 2.25}
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'h-10 w-full pl-9 text-body md:h-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          appearance === 'inset' &&
            'h-11 rounded-lg border-foreground/20 bg-card text-foreground placeholder:text-foreground/65 md:h-11',
          appearance === 'pill' &&
            'h-8 rounded-full border-border bg-card py-0 pl-8 text-body leading-none text-foreground placeholder:text-body placeholder:text-muted-foreground',
        )}
        disabled
      />
    </div>
  );
}

export type HeaderSearchAppearance = 'default' | 'inset' | 'pill';

export interface HeaderSearchProps {
  className?: string;
  /**
   * Accessible label distinguishing multiple search fields on one page.
   * Defaults to "Search listings". The header bar instance and the mobile sheet
   * instance should carry different labels so assistive tech does not announce
   * two identical controls.
   */
  ariaLabel?: string;
  /**
   * Overrides the default prompt. Listing detail runs a shorter one, because
   * the trailing Report and Share buttons leave the pill too narrow for the
   * full sentence.
   */
  placeholder?: string;
  /** Focus the field on mount — used by the mobile search sheet. */
  autoFocus?: boolean;
  /** Fires after a query or listing pick navigates away. */
  onNavigate?: () => void;
  /**
   * Control parked inside the field, after the clear button — the catalog
   * filter glyph lives here so search and refine are one bar.
   */
  trailing?: ReactNode;
  /** `inset` is a cream in-page field. `pill` is the seamless mobile chrome. */
  appearance?: HeaderSearchAppearance;
}

/** Keeps useSearchParams behind Suspense so non-dynamic pages can prerender. */
export function HeaderSearch({
  className,
  ariaLabel = 'Search listings',
  placeholder = PLACEHOLDER,
  autoFocus = false,
  onNavigate,
  trailing,
  appearance = 'default',
}: HeaderSearchProps) {
  return (
    <Suspense
      fallback={
        <HeaderSearchFallback
          className={className}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          appearance={appearance}
        />
      }
    >
      <HeaderSearchInner
        className={className}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onNavigate={onNavigate}
        trailing={trailing}
        appearance={appearance}
      />
    </Suspense>
  );
}

function HeaderSearchInner({
  className,
  ariaLabel,
  placeholder,
  autoFocus,
  onNavigate,
  trailing,
  appearance,
}: {
  className?: string;
  ariaLabel: string;
  placeholder: string;
  autoFocus: boolean;
  onNavigate?: () => void;
  trailing?: ReactNode;
  appearance: HeaderSearchAppearance;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onCatalog = pathname === '/listings';
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<number | null>(null);
  const debounceRef = useRef<number | null>(null);
  const suggestGenRef = useRef(0);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<CatalogSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => retainSlashListener(), []);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  useEffect(() => subscribeCatalogQuery(setQuery), []);

  const urlQuery = searchParams.get('q') ?? '';
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  function listingsHref(nextQuery: string): string {
    const trimmed = nextQuery.trim();
    if (onCatalog) {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      params.delete('page');
      const qs = params.toString();
      return qs ? `/listings?${qs}` : '/listings';
    }
    return trimmed ? `/listings?q=${encodeURIComponent(trimmed)}` : '/listings';
  }

  function scheduleSuggest(nextQuery: string) {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const trimmed = nextQuery.trim();
    const gen = ++suggestGenRef.current;

    if (trimmed.length < SUGGEST_MIN) {
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void suggestCatalogItems({
        q: trimmed,
        region: searchParamsRef.current.get('region'),
      }).then((result) => {
        if (gen !== suggestGenRef.current) return;
        setLoading(false);
        setHits(result.ok ? result.data : []);
        setHighlight(0);
      });
    }, DEBOUNCE_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(false);
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (onCatalog && requestCatalogBrowse({ q: trimmed || null })) {
      onNavigate?.();
      return;
    }
    onNavigate?.();
    startTransition(() => router.push(listingsHref(query)));
  }

  function clearQuery() {
    setQuery('');
    setHits([]);
    setOpen(false);
    setLoading(false);
    suggestGenRef.current += 1;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    if (onCatalog && requestCatalogBrowse({ q: null })) {
      inputRef.current?.focus();
      return;
    }
    if (urlQuery) {
      startTransition(() => router.push(listingsHref('')));
    }
    inputRef.current?.focus();
  }

  function openListing(id: string) {
    setOpen(false);
    onNavigate?.();
    startTransition(() => router.push(`/listings/${id}`));
  }

  const showList = open && query.trim().length >= SUGGEST_MIN;
  const showAllIndex = hits.length;
  const optionCount = hits.length + 1;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (showList) {
        setOpen(false);
        return;
      }
      if (query) clearQuery();
      else inputRef.current?.blur();
      return;
    }

    if (!showList) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % optionCount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + optionCount) % optionCount);
      return;
    }
    if (event.key === 'Enter' && highlight < hits.length) {
      event.preventDefault();
      openListing(hits[highlight].id);
    }
  }

  const activeOptionId = showList
    ? highlight < hits.length
      ? `${listId}-hit-${highlight}`
      : `${listId}-all`
    : undefined;

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className={cn('relative w-full', className)}
    >
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 z-[1] -translate-y-1/2',
          appearance === 'pill' ? 'left-2.5 size-3' : 'left-3 size-4',
          appearance === 'default' ? 'text-parchment' : 'text-foreground',
        )}
        strokeWidth={appearance === 'default' ? 2 : 2.25}
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        name="q"
        value={query}
        data-market-search=""
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          scheduleSuggest(next);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (blurTimerRef.current != null) {
            window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          if (query.trim().length >= SUGGEST_MIN) setOpen(true);
        }}
        onBlur={() => {
          if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
          blurTimerRef.current = window.setTimeout(() => {
            blurTimerRef.current = null;
            setOpen(false);
          }, 150);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          // Default / inset keep Input's 16px mobile size so iOS will not zoom.
          // The compact chrome pill is `text-body` — same size as the games row.
          'h-10 w-full pl-9 text-body md:h-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          appearance === 'inset' &&
            'h-11 rounded-lg border-foreground/20 bg-card text-foreground placeholder:text-foreground/65 md:h-11',
          appearance === 'pill' &&
            'h-8 rounded-full border-border bg-card py-0 pl-8 text-body leading-none text-foreground placeholder:text-body placeholder:text-muted-foreground',
          trailing && query ? 'pr-[4.5rem]' : trailing || query ? 'pr-10' : 'pr-3',
        )}
      />
      {query ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearQuery}
          aria-label="Clear search"
          className={cn(
            'absolute top-1/2 z-[1] grid size-8 -translate-y-1/2 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:border-gold/40',
            trailing ? 'right-9' : 'right-1',
          )}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {trailing ? (
        <div className="absolute right-1 top-1/2 z-[1] -translate-y-1/2">
          {trailing}
        </div>
      ) : null}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching listings"
          className={cn(
            'absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-md border border-border py-1 shadow-md',
            appearance === 'default'
              ? 'bg-popover text-popover-foreground'
              : 'bg-card text-foreground',
          )}
        >
          {loading && hits.length === 0 ? (
            <li className="px-3 py-2 text-meta text-muted-foreground" aria-live="polite">
              Searching…
            </li>
          ) : null}
          {hits.map((hit, index) => {
            const thumb = itemImageUrl(hit.imagePath);
            const active = highlight === index;
            return (
              <li key={hit.id} role="presentation">
                <Link
                  href={`/listings/${hit.id}`}
                  id={`${listId}-hit-${index}`}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left focus:outline-none focus-visible:border-gold/40',
                    appearance === 'default'
                      ? active
                        ? 'bg-accent'
                        : 'hover:bg-muted/70 focus-visible:bg-accent'
                      : active
                        ? 'bg-muted'
                        : 'bg-card hover:bg-muted/70',
                  )}
                >
                  <span className="relative size-9 shrink-0 overflow-hidden rounded-sm border border-border bg-muted">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" width={36} height={36} className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{hit.title}</span>
                    <span className="block truncate text-meta text-muted-foreground">
                      {hit.category}
                      {' · '}
                      {formatMoney(hit.fmvCents, hit.currency)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
          {!loading && hits.length === 0 ? (
            <li className="px-3 py-2 text-meta text-muted-foreground">No matching titles</li>
          ) : null}
          <li role="presentation">
            <button
              type="submit"
              id={`${listId}-all`}
              role="option"
              aria-selected={highlight === showAllIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(showAllIndex)}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-body',
                appearance === 'default'
                  ? highlight === showAllIndex
                    ? 'bg-accent'
                    : 'hover:bg-muted/70'
                  : highlight === showAllIndex
                    ? 'bg-muted'
                    : 'bg-card',
                hits.length > 0 && 'mt-1 border-t border-border',
              )}
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">
                Search listings for “{query.trim()}”
              </span>
            </button>
          </li>
        </ul>
      ) : null}
    </form>
  );
}
