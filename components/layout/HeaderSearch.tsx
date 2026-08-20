'use client';

// Site-wide jump search. Finds a listing from anywhere: typeahead opens the
// card, Enter starts a marketplace query. Already on `/listings`, that query
// is applied in place so the page is not remounted. It does not live-filter
// the grid — that is `CatalogFilterSearch`.

import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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

function HeaderSearchFallback({ className, ariaLabel }: { className?: string; ariaLabel: string }) {
  return (
    <div role="search" className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        placeholder={PLACEHOLDER}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full pl-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        disabled
      />
    </div>
  );
}

export interface HeaderSearchProps {
  className?: string;
  /**
   * Accessible label distinguishing multiple search fields on one page.
   * Defaults to "Search listings". The header bar instance and the mobile menu
   * instance should carry different labels so assistive tech does not announce
   * two identical controls.
   */
  ariaLabel?: string;
}

/** Keeps useSearchParams behind Suspense so non-dynamic pages can prerender. */
export function HeaderSearch({ className, ariaLabel = 'Search listings' }: HeaderSearchProps) {
  return (
    <Suspense fallback={<HeaderSearchFallback className={className} ariaLabel={ariaLabel} />}>
      <HeaderSearchInner className={className} ariaLabel={ariaLabel} />
    </Suspense>
  );
}

function HeaderSearchInner({ className, ariaLabel }: { className?: string; ariaLabel: string }) {
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
      return;
    }
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
        className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-muted-foreground"
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
        placeholder={PLACEHOLDER}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          'h-9 w-full pl-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          query ? 'pr-9' : 'pr-3',
        )}
      />
      {query ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearQuery}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 z-[1] grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching listings"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
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
                    'flex min-h-11 w-full items-center gap-2.5 px-2 py-2 text-left focus:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    active ? 'bg-accent' : 'hover:bg-muted/70',
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
                highlight === showAllIndex ? 'bg-accent' : 'hover:bg-muted/70',
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
