'use client';

// Site-wide jump search. Finds a listing from anywhere: typeahead opens the
// card, Enter starts a marketplace query. Already on the catalog (`/`), that
// query is applied in place so the page is not remounted. It is the catalog's
// only search field. Phone chrome uses `appearance="pill"`.

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
import { HugeiconsIcon } from '@hugeicons/react';
import { Clock01Icon, LayoutGridIcon, Search01Icon, XIcon } from '@hugeicons/core-free-icons';

import {
  suggestCatalogItems,
  suggestSellers,
  type CatalogSuggestion,
  type SellerSuggestion,
} from '@/lib/actions/listings';
import { CARD_GAMES } from '@/lib/catalog/cardGames';
import { Avatar } from '@/components/ui/avatar';
import { requestCatalogBrowse, subscribeCatalogQuery } from '@/lib/catalog/browseEvents';
import { Input } from '@/components/ui/input';
import { StorageImage } from '@/components/ui/storage-image';
import { formatMoney, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

const PLACEHOLDER = 'Search a card, set, or player…';

/** Recent searches, newest first. Versioned key; see `readRecent`. */
const RECENT_KEY = 'noditto:recent-searches:v1';
const RECENT_MAX = 5;

/** Games offered on an empty, focused field: the first few of the catalog's list. */
const GAME_SHORTCUTS = CARD_GAMES.slice(0, 4);

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    // Storage is unavailable in private modes and when full; recents are a nicety.
    return [];
  }
}

function rememberSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const next = [trimmed, ...readRecent().filter((v) => v.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // See readRecent.
  }
}

/** One selectable row in the dropdown, whatever group it is in. */
interface SearchOption {
  id: string;
  group: 'Recent searches' | 'Games' | 'Listings' | 'Sellers' | 'search';
  select: () => void;
}
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
      const candidates = document.querySelectorAll<HTMLInputElement>('input[data-market-search]');
      for (const field of candidates) {
        if (field.disabled || field.getClientRects().length === 0) continue;
        event.preventDefault();
        field.focus();
        field.select();
        return;
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
      <HugeiconsIcon icon={Search01Icon}
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2',
          appearance === 'pill' ? 'left-2.5 size-3' : 'left-3 size-4',
          appearance === 'default' ? 'text-mist' : 'text-foreground',
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
          'h-10 w-full pl-9 md:h-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          appearance === 'inset' &&
            'h-11 rounded-lg border-foreground/20 bg-card text-foreground placeholder:text-foreground/65 md:h-11',
          appearance === 'pill' &&
            'h-8 rounded-full border-border bg-card py-0 pl-section leading-none text-foreground placeholder:text-muted-foreground md:h-8',
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
  const onCatalog = pathname === '/';
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
  const [sellerHits, setSellerHits] = useState<SellerSuggestion[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
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
      // The one-shot "arrive focused" flag from the phone Search tab, not a filter.
      params.delete('search');
      const qs = params.toString();
      return qs ? `/?${qs}` : '/';
    }
    return trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/';
  }

  function scheduleSuggest(nextQuery: string) {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const trimmed = nextQuery.trim();
    const gen = ++suggestGenRef.current;

    if (trimmed.length < SUGGEST_MIN) {
      setHits([]);
      setSellerHits([]);
      setLoading(false);
      setHighlight(0);
      return;
    }

    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void Promise.all([
        suggestCatalogItems({ q: trimmed, region: searchParamsRef.current.get('region') }),
        suggestSellers(trimmed),
      ]).then(([listings, sellers]) => {
        if (gen !== suggestGenRef.current) return;
        setLoading(false);
        setHits(listings.ok ? listings.data : []);
        setSellerHits(sellers.ok ? sellers.data : []);
        setHighlight(0);
      });
    }, DEBOUNCE_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(false);
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    rememberSearch(trimmed);
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

  function runSearch(nextQuery: string) {
    setQuery(nextQuery);
    setOpen(false);
    rememberSearch(nextQuery);
    if (onCatalog && requestCatalogBrowse({ q: nextQuery || null })) {
      onNavigate?.();
      return;
    }
    onNavigate?.();
    startTransition(() => router.push(listingsHref(nextQuery)));
  }

  function openGame(name: string) {
    setOpen(false);
    setQuery('');
    if (onCatalog && requestCatalogBrowse({ category: name, q: null })) {
      onNavigate?.();
      return;
    }
    onNavigate?.();
    startTransition(() => router.push(`/?category=${encodeURIComponent(name)}`));
  }

  function openSeller(id: string) {
    setOpen(false);
    onNavigate?.();
    startTransition(() => router.push(`/sellers/${id}`));
  }

  const trimmedQuery = query.trim();
  const typing = trimmedQuery.length >= SUGGEST_MIN;
  // ON FOCUS, BEFORE TYPING: recent searches and a few games, so the field offers a
  // next step instead of waiting for two characters. While typing: matching games,
  // listings, sellers, then "search for" — grouped, so a name finds a person and a
  // game finds the game, not only titles that happen to contain it.
  const gameMatches = typing
    ? CARD_GAMES.filter((game) => game.name.toLowerCase().includes(trimmedQuery.toLowerCase())).slice(0, 2)
    : GAME_SHORTCUTS;
  const options: SearchOption[] = typing
    ? [
        ...gameMatches.map((game) => ({ id: `${listId}-game-${game.slug}`, group: 'Games' as const, select: () => openGame(game.name) })),
        ...hits.map((hit) => ({ id: `${listId}-hit-${hit.id}`, group: 'Listings' as const, select: () => openListing(hit.id) })),
        ...sellerHits.map((seller) => ({ id: `${listId}-seller-${seller.id}`, group: 'Sellers' as const, select: () => openSeller(seller.id) })),
        { id: `${listId}-all`, group: 'search' as const, select: () => runSearch(trimmedQuery) },
      ]
    : [
        ...recent.map((term, index) => ({ id: `${listId}-recent-${index}`, group: 'Recent searches' as const, select: () => runSearch(term) })),
        ...gameMatches.map((game) => ({ id: `${listId}-game-${game.slug}`, group: 'Games' as const, select: () => openGame(game.name) })),
      ];
  const showList = open && (typing || (trimmedQuery === '' && options.length > 0));

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

    if (!showList || options.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % options.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + options.length) % options.length);
      return;
    }
    // The last typed option is the form's own submit; Enter there submits as usual.
    if (event.key === 'Enter' && options[highlight] && options[highlight].group !== 'search') {
      event.preventDefault();
      options[highlight].select();
    }
  }

  const activeOptionId = showList ? options[highlight]?.id : undefined;

  /** Shared row styling for every option, highlighted or not. */
  const optionClass = (active: boolean) =>
    cn(
      'flex min-h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-snug py-snug text-left focus:outline-none focus-visible:border-iris',
      appearance === 'default'
        ? active
          ? 'bg-accent'
          : 'hover:bg-muted/70 focus-visible:bg-accent'
        : active
          ? 'bg-muted'
          : 'bg-card hover:bg-muted/70',
    );
  const groupHeading = (label: string) => (
    <li role="presentation" className="px-snug pb-0.5 pt-snug text-meta font-medium text-muted-foreground">
      {label}
    </li>
  );
  const indexOf = (id: string) => options.findIndex((option) => option.id === id);

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className={cn('relative w-full', className)}
    >
      <HugeiconsIcon icon={Search01Icon}
        className={cn(
          'pointer-events-none absolute top-1/2 z-[1] -translate-y-1/2',
          appearance === 'pill' ? 'left-2.5 size-3' : 'left-3 size-4',
          appearance === 'default' ? 'text-mist' : 'text-foreground',
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
          setRecent(readRecent());
          setOpen(true);
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
          // NO font-size on any appearance. All three inherit Input's `text-body`, so
          // a change to the field type reaches this field too instead of stopping here.
          //
          // Worth stating because it has been broken twice: the base string set
          // `text-body` under a comment claiming the opposite, and the chrome pill set
          // it again to match the games row — both winning over Input through
          // tailwind-merge. That resolves to the same size today, but while Input still
          // floored touch at 16px it pinned the public catalog search, the first thing a
          // phone visitor taps, at a size iOS Safari zooms in on and does not undo.
          'h-10 w-full pl-9 md:h-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          appearance === 'inset' &&
            'h-11 rounded-lg border-foreground/20 bg-card text-foreground placeholder:text-foreground/65 md:h-11',
          appearance === 'pill' &&
            'h-8 rounded-full border-border bg-card py-0 pl-section leading-none text-foreground placeholder:text-muted-foreground md:h-8',
          trailing && query ? 'pr-[4.5rem]' : trailing || query ? 'pr-10' : 'pr-cozy',
        )}
      />
      {query ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearQuery}
          aria-label="Clear search"
          className={cn(
            'absolute top-1/2 z-[1] grid size-8 -translate-y-1/2 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:border-iris',
            trailing ? 'right-9' : 'right-1',
          )}
        >
          <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
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
          aria-label="Search suggestions"
          className={cn(
            'absolute inset-x-0 top-full z-50 mt-tight max-h-96 overflow-auto rounded-md border border-border px-tight py-tight shadow-md',
            appearance === 'default'
              ? 'bg-popover text-popover-foreground'
              : 'bg-card text-foreground',
          )}
        >
          {!typing && recent.length > 0 ? groupHeading('Recent searches') : null}
          {!typing
            ? recent.map((term, index) => {
                const id = `${listId}-recent-${index}`;
                const optionIndex = indexOf(id);
                return (
                  <li key={id} role="presentation">
                    <button
                      type="button"
                      id={id}
                      role="option"
                      aria-selected={highlight === optionIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(optionIndex)}
                      onClick={() => runSearch(term)}
                      className={optionClass(highlight === optionIndex)}
                    >
                      <HugeiconsIcon icon={Clock01Icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-body">{term}</span>
                    </button>
                  </li>
                );
              })
            : null}

          {gameMatches.length > 0 ? groupHeading(typing ? 'Games' : 'Browse a game') : null}
          {gameMatches.map((game) => {
            const id = `${listId}-game-${game.slug}`;
            const optionIndex = indexOf(id);
            return (
              <li key={id} role="presentation">
                <button
                  type="button"
                  id={id}
                  role="option"
                  aria-selected={highlight === optionIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(optionIndex)}
                  onClick={() => openGame(game.name)}
                  className={optionClass(highlight === optionIndex)}
                >
                  <HugeiconsIcon icon={LayoutGridIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body">{game.name}</span>
                </button>
              </li>
            );
          })}

          {typing && loading && hits.length === 0 && sellerHits.length === 0 ? (
            <li className="px-cozy py-snug text-meta text-muted-foreground" aria-live="polite">
              Searching…
            </li>
          ) : null}
          {typing && hits.length > 0 ? groupHeading('Listings') : null}
          {typing
            ? hits.map((hit) => {
                const id = `${listId}-hit-${hit.id}`;
                const optionIndex = indexOf(id);
                const thumb = itemImageUrl(hit.imagePath);
                return (
                  <li key={id} role="presentation">
                    <Link
                      href={`/listings/${hit.id}`}
                      id={id}
                      role="option"
                      aria-selected={highlight === optionIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(optionIndex)}
                      onClick={() => setOpen(false)}
                      className={optionClass(highlight === optionIndex)}
                    >
                      <span className="relative size-9 shrink-0 overflow-hidden rounded-sm border border-border bg-muted">
                        {thumb ? (
                          <StorageImage src={thumb} alt="" sizes="36px" className="object-cover" loading="lazy" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium">{hit.title}</span>
                        <span className="block truncate text-meta text-muted-foreground">
                          {hit.category}
                          {' · '}
                          {hit.isShopfront ? 'from ' : null}
                          {formatMoney(hit.listedCents, hit.currency)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })
            : null}

          {typing && sellerHits.length > 0 ? groupHeading('Sellers') : null}
          {typing
            ? sellerHits.map((seller) => {
                const id = `${listId}-seller-${seller.id}`;
                const optionIndex = indexOf(id);
                return (
                  <li key={id} role="presentation">
                    <Link
                      href={`/sellers/${seller.id}`}
                      id={id}
                      role="option"
                      aria-selected={highlight === optionIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(optionIndex)}
                      onClick={() => setOpen(false)}
                      className={optionClass(highlight === optionIndex)}
                    >
                      <Avatar avatarPath={seller.avatarPath} displayName={seller.displayName} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-body">{seller.displayName}</span>
                      {seller.isVerified ? (
                        <span className="shrink-0 text-meta text-trust">ID verified</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })
            : null}

          {typing && !loading && hits.length === 0 && sellerHits.length === 0 && gameMatches.length === 0 ? (
            <li className="px-cozy py-snug text-meta text-muted-foreground">
              No close matches. Search anyway, or try fewer words.
            </li>
          ) : null}
          {typing ? (
            <li role="presentation">
              <button
                type="submit"
                id={`${listId}-all`}
                role="option"
                aria-selected={options[highlight]?.group === 'search'}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(options.length - 1)}
                className={cn(optionClass(options[highlight]?.group === 'search'), 'mt-tight border-t border-border')}
              >
                <HugeiconsIcon icon={Search01Icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate text-body">Search listings for “{trimmedQuery}”</span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </form>
  );
}
