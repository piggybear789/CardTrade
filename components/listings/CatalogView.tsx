'use client';

// Owns marketplace browse after first paint. Pills, sort, and the filter rail
// used to router.push, which remounted the page (loading skeleton + every
// image). Those updates now fetch in place and only rewrite the URL.

import {
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchCatalogPage,
  type CatalogFacets,
  type CatalogItem,
  type CatalogSort,
} from '@/lib/actions/listings';
import { notifyCatalogQuery, subscribeCatalogBrowse } from '@/lib/catalog/browseEvents';

const COUNT_FORMATTER = new Intl.NumberFormat('en-AU');
const SORT_KEYS: CatalogSort[] = ['newest', 'price-asc', 'price-desc', 'rating'];

export interface CatalogBrowseCurrent {
  q: string;
  categories: string[];
  conditions: string[];
  min: string;
  max: string;
  includeSold: boolean;
  sort: CatalogSort;
  page: number;
}

export interface CatalogBrowseSnapshot {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  watchingIds: string[];
  matchedQuery?: string;
  currentUserId: string | null;
  regionCode: string | null;
  regionParam: string | null;
  facets: CatalogFacets;
  current: CatalogBrowseCurrent;
}

interface CatalogResultState {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  watchingIds: string[];
  matchedQuery?: string;
}

interface CatalogViewValue {
  filter: string;
  setFilter: (value: string) => void;
  matchCount: number | null;
  setMatchCount: (value: number | null) => void;
  current: CatalogBrowseCurrent;
  /** Last query that matches `result` — heading and chips wait for this. */
  settled: CatalogBrowseCurrent;
  result: CatalogResultState;
  revision: number;
  isPending: boolean;
  currentUserId: string | null;
  regionCode: string | null;
  facets: CatalogFacets;
  apply: (updates: Record<string, string | string[] | null>) => void;
  reset: () => void;
  selectGame: (name: string | null) => void;
  goToPage: (page: number) => void;
  hrefForPage: (page: number) => string;
  regionParam: string | null;
}

const CatalogViewContext = createContext<CatalogViewValue | null>(null);

export function CatalogViewProvider({
  initial,
  children,
}: {
  initial: CatalogBrowseSnapshot;
  children: ReactNode;
}) {
  const [filter, setFilter] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [current, setCurrent] = useState(initial.current);
  const [settled, setSettled] = useState(initial.current);
  const [result, setResult] = useState<CatalogResultState>({
    items: initial.items,
    total: initial.total,
    page: initial.page,
    pageSize: initial.pageSize,
    hasMore: initial.hasMore,
    watchingIds: initial.watchingIds,
    matchedQuery: initial.matchedQuery,
  });
  const [revision, setRevision] = useState(0);
  const [isPending, setPending] = useState(false);
  const fetchGen = useRef(0);
  const currentRef = useRef(current);
  currentRef.current = current;
  const regionParamRef = useRef(initial.regionParam);
  const regionCodeRef = useRef(initial.regionCode);

  const runFetch = useCallback(async (next: CatalogBrowseCurrent) => {
    const gen = ++fetchGen.current;
    setPending(true);
    const fetched = await fetchCatalogPage({
      q: next.q || undefined,
      categories: next.categories,
      conditions: next.conditions,
      minCents: dollarsToCents(next.min),
      maxCents: dollarsToCents(next.max),
      includeSold: next.includeSold || undefined,
      sort: next.sort,
      page: next.page,
      regionCode: regionCodeRef.current,
    });
    if (gen !== fetchGen.current) return;
    startTransition(() => {
      setPending(false);
      if (!fetched.ok) return;
      setSettled(next);
      setResult({
        items: fetched.items,
        total: fetched.total,
        page: fetched.page,
        pageSize: fetched.pageSize,
        hasMore: fetched.hasMore,
        watchingIds: fetched.watchingIds,
        matchedQuery: fetched.matchedQuery,
      });
      setRevision((value) => value + 1);
    });
  }, []);

  const resultRef = useRef(result);
  resultRef.current = result;

  const apply = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const previousQ = currentRef.current.q;
      const next = mergeBrowseCurrent(currentRef.current, updates);
      setCurrent(next);
      writeCatalogUrl(next, regionParamRef.current);
      if (next.q !== previousQ) notifyCatalogQuery(next.q);
      void runFetch(next);
    },
    [runFetch],
  );

  const reset = useCallback(() => {
    const next = emptyBrowseCurrent();
    setCurrent(next);
    setFilter('');
    writeCatalogUrl(next, null);
    notifyCatalogQuery('');
    void runFetch(next);
  }, [runFetch]);

  const selectGame = useCallback(
    (name: string | null) => {
      // A failed text search plus a game pill is still a failed text search.
      // Picking a game from an empty grid is an escape hatch, not a refine.
      if (resultRef.current.total === 0 && currentRef.current.q) {
        apply({ category: name, q: null });
        return;
      }
      apply({ category: name });
    },
    [apply],
  );

  const goToPage = useCallback(
    (page: number) => {
      apply({ page: String(page) });
    },
    [apply],
  );

  useEffect(() => {
    function onPop() {
      const next = browseCurrentFromSearch(window.location.search);
      setCurrent(next);
      void runFetch(next);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [runFetch]);

  useEffect(() => subscribeCatalogBrowse(apply), [apply]);

  const value = useMemo(
    () => ({
      filter,
      setFilter,
      matchCount,
      setMatchCount,
      current,
      settled,
      result,
      revision,
      isPending,
      currentUserId: initial.currentUserId,
      regionCode: initial.regionCode,
      facets: initial.facets,
      apply,
      reset,
      selectGame,
      goToPage,
      hrefForPage: (page: number) =>
        catalogHref(current, regionParamRef.current, page),
      regionParam: initial.regionParam,
    }),
    [
      filter,
      matchCount,
      current,
      settled,
      result,
      revision,
      isPending,
      initial.currentUserId,
      initial.regionCode,
      initial.regionParam,
      initial.facets,
      apply,
      reset,
      selectGame,
      goToPage,
    ],
  );

  return <CatalogViewContext value={value}>{children}</CatalogViewContext>;
}

export function useCatalogView(): CatalogViewValue {
  const value = use(CatalogViewContext);
  if (!value) {
    throw new Error('useCatalogView must be used inside CatalogViewProvider');
  }
  return value;
}

/** Count under the catalog heading. Updates live while the filter is typed. */
export function CatalogResultCount({ note }: { note?: string }) {
  const { filter, matchCount, result } = useCatalogView();
  const filtering = filter.trim() !== '';
  const count = filtering ? (matchCount ?? 0) : result.total;

  return (
    <p className="text-pretty text-meta text-muted-foreground sm:mt-0.5 sm:text-body" aria-live="polite">
      <span className="tabular-nums">
        {filtering
          ? `${COUNT_FORMATTER.format(count)} matching`
          : `${COUNT_FORMATTER.format(count)} ${count === 1 ? 'listing' : 'listings'}`}
      </span>
      {note ? <span>{` · ${note}`}</span> : null}
    </p>
  );
}

export function emptyBrowseCurrent(): CatalogBrowseCurrent {
  return {
    q: '',
    categories: [],
    conditions: [],
    min: '',
    max: '',
    includeSold: false,
    sort: 'newest',
    page: 1,
  };
}

function mergeBrowseCurrent(
  current: CatalogBrowseCurrent,
  updates: Record<string, string | string[] | null>,
): CatalogBrowseCurrent {
  const next = { ...current };
  let resetPage = true;

  if ('q' in updates) next.q = asString(updates.q);
  if ('category' in updates) next.categories = asList(updates.category);
  if ('condition' in updates) next.conditions = asList(updates.condition);
  if ('min' in updates) next.min = asString(updates.min);
  if ('max' in updates) next.max = asString(updates.max);
  if ('sold' in updates) next.includeSold = asString(updates.sold) === '1';
  if ('sort' in updates) {
    const sort = asString(updates.sort) as CatalogSort;
    next.sort = SORT_KEYS.includes(sort) ? sort : 'newest';
  }
  if ('page' in updates) {
    const page = Number(asString(updates.page));
    next.page = Number.isFinite(page) && page > 1 ? Math.trunc(page) : 1;
    resetPage = false;
  }
  if (resetPage) next.page = 1;
  return next;
}

function asString(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function asList(value: string | string[] | null | undefined): string[] {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

function writeCatalogUrl(current: CatalogBrowseCurrent, regionParam: string | null) {
  const params = new URLSearchParams();
  if (current.q) params.set('q', current.q);
  for (const category of current.categories) params.append('category', category);
  for (const condition of current.conditions) params.append('condition', condition);
  if (current.min) params.set('min', current.min);
  if (current.max) params.set('max', current.max);
  if (current.includeSold) params.set('sold', '1');
  if (current.sort !== 'newest') params.set('sort', current.sort);
  if (current.page > 1) params.set('page', String(current.page));
  if (regionParam) params.set('region', regionParam);
  if (window.location.search.includes('filters=1')) params.set('filters', '1');
  const qs = params.toString();
  const href = qs ? `/listings?${qs}` : '/listings';
  window.history.replaceState(window.history.state, '', href);
}

function catalogHref(
  current: CatalogBrowseCurrent,
  regionParam: string | null,
  page: number,
): string {
  const params = new URLSearchParams();
  if (current.q) params.set('q', current.q);
  for (const category of current.categories) params.append('category', category);
  for (const condition of current.conditions) params.append('condition', condition);
  if (current.min) params.set('min', current.min);
  if (current.max) params.set('max', current.max);
  if (current.includeSold) params.set('sold', '1');
  if (current.sort !== 'newest') params.set('sort', current.sort);
  if (page > 1) params.set('page', String(page));
  if (regionParam) params.set('region', regionParam);
  if (typeof window !== 'undefined' && window.location.search.includes('filters=1')) {
    params.set('filters', '1');
  }
  const qs = params.toString();
  return qs ? `/listings?${qs}` : '/listings';
}

export function browseCurrentFromSearch(search: string): CatalogBrowseCurrent {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sortRaw = params.get('sort') as CatalogSort | null;
  const pageRaw = Number(params.get('page'));
  return {
    q: params.get('q')?.trim() ?? '',
    categories: params.getAll('category').flatMap((value) => value.split(',').map((part) => part.trim()).filter(Boolean)),
    conditions: params.getAll('condition').flatMap((value) => value.split(',').map((part) => part.trim()).filter(Boolean)),
    min: params.get('min')?.trim() ?? '',
    max: params.get('max')?.trim() ?? '',
    includeSold: params.get('sold') === '1',
    sort: sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : 'newest',
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? Math.trunc(pageRaw) : 1,
  };
}
