'use client';

// Mobile infinite catalog: append pages as the sentinel enters the viewport.
// Desktop paging lives in CatalogResults and refetches through CatalogView.

import { useDeferredValue, useEffect, useMemo, useRef, useState, ViewTransition } from 'react';
import { Loader2 } from 'lucide-react';

import {
  fetchCatalogPage,
  type CatalogItem,
  type CatalogSort,
  type SearchCatalogParams,
} from '@/lib/actions/listings';
import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { CatalogItemCard } from '@/components/listings/ItemCard';
import { useCatalogView } from '@/components/listings/CatalogView';

const MOBILE_MAX = '(max-width: 1023px)';

export interface CatalogInfiniteGridProps {
  /** Bumps when the browse query is replaced so we reset without remounting. */
  revision: number;
  initialItems: CatalogItem[];
  initialPage: number;
  initialHasMore: boolean;
  currentUserId: string | null;
  initialWatchingIds: string[];
  /**
   * The predicates the first page was fetched with, replayed for every page after
   * it. Anything missing here is silently dropped on scroll, which appends items
   * the active filters exclude — `conditions` and `regionCode` were both added
   * after exactly that.
   */
  query: {
    q: string;
    categories: string[];
    conditions: string[];
    minCents?: number;
    maxCents?: number;
    includeSold: boolean;
    sort: CatalogSort;
    /** Region scope (0065). Must be replayed, or scrolling leaves the region. */
    regionCode?: string | null;
  };
}

export function CatalogInfiniteGrid({
  revision,
  initialItems,
  initialPage,
  initialHasMore,
  currentUserId,
  initialWatchingIds,
  query,
}: CatalogInfiniteGridProps) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [watchingIds, setWatchingIds] = useState(
    () => new Set(initialWatchingIds),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { filter, setMatchCount } = useCatalogView();
  const deferredFilter = useDeferredValue(filter);
  const visibleItems = useMemo(
    () => filterCatalogItems(items, deferredFilter),
    [items, deferredFilter],
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  // Pages already merged into `items` — blocks Strict Mode double-fetch of
  // the same next page before state commits.
  const loadedPagesRef = useRef(new Set<number>([initialPage]));

  // Latest inputs for the observer callback — avoids stale closures without
  // useEffectEvent (not available in Next's SSR React build).
  const stateRef = useRef({ page, hasMore, query });
  stateRef.current = { page, hasMore, query };

  const loadMoreRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(
    async () => {},
  );

  loadMoreRef.current = async (opts) => {
    const { page: currentPage, hasMore: canLoad, query: q } = stateRef.current;
    if (inFlightRef.current || !canLoad) return;
    if (!opts?.force && !window.matchMedia(MOBILE_MAX).matches) return;

    const nextPage = currentPage + 1;
    if (!opts?.force && loadedPagesRef.current.has(nextPage)) return;

    inFlightRef.current = true;
    loadedPagesRef.current.add(nextPage);
    setLoadingMore(true);
    setError(null);

    const params: SearchCatalogParams = {
      q: q.q || undefined,
      categories: q.categories,
      conditions: q.conditions,
      minCents: q.minCents,
      maxCents: q.maxCents,
      includeSold: q.includeSold || undefined,
      sort: q.sort,
      regionCode: q.regionCode ?? undefined,
      page: nextPage,
    };

    try {
      const result = await fetchCatalogPage(params);
      if (!result.ok) {
        loadedPagesRef.current.delete(nextPage);
        setError('Could not load more listings. Tap to try again.');
        return;
      }

      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        const appended = result.items.filter((item) => !seen.has(item.id));
        return appended.length === 0 ? current : [...current, ...appended];
      });
      setWatchingIds((current) => {
        const next = new Set(current);
        for (const id of result.watchingIds) next.add(id);
        return next;
      });
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch {
      loadedPagesRef.current.delete(nextPage);
      setError('Could not load more listings. Tap to try again.');
    } finally {
      inFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setItems(initialItems);
    setPage(initialPage);
    setHasMore(initialHasMore);
    setWatchingIds(new Set(initialWatchingIds));
    setError(null);
    loadedPagesRef.current = new Set([initialPage]);
    // Only `revision` — a new watchingIds array on an unrelated parent render
    // must not wipe pages already appended on mobile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  useEffect(() => {
    if (!filter.trim()) {
      setMatchCount(null);
      return;
    }
    setMatchCount(visibleItems.length);
  }, [filter, visibleItems.length, setMatchCount]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { root: null, rootMargin: '320px 0px', threshold: 0 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className={CATALOG_TILE_GRID}>
        {visibleItems.length === 0 ? (
          <p className="col-span-full py-10 text-center text-body text-muted-foreground">
            No listings here match “{filter.trim()}”.
          </p>
        ) : (
          visibleItems.map((item) => (
            <ViewTransition key={item.id} enter="fade-in" exit="fade-out" default="none">
              <CatalogItemCard
                item={item}
                initialWatching={
                  currentUserId && item.owner_id !== currentUserId
                    ? watchingIds.has(item.id)
                    : undefined
                }
              />
            </ViewTransition>
          ))
        )}
      </div>

      {/* Sentinel + status — mobile only; desktop uses the page nav below. */}
      <div className="lg:hidden">
        <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
        {hasMore && !loadingMore && !error ? (
          <button
            type="button"
            onClick={() => void loadMoreRef.current({ force: true })}
            className="mt-snug w-full rounded-lg border border-border px-group py-cozy text-body font-medium text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:border-gold/40"
          >
            Load more listings
          </button>
        ) : null}
        <div className="flex flex-col items-center gap-snug py-6" aria-live="polite">
          {loadingMore ? (
            <p className="flex items-center gap-snug text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading more…
            </p>
          ) : null}
          {error ? (
            <button
              type="button"
              onClick={() => void loadMoreRef.current({ force: true })}
              className="rounded-md text-body font-medium text-foreground underline-offset-4 hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40"
            >
              {error}
            </button>
          ) : null}
          {!hasMore && !loadingMore && visibleItems.length > 0 ? (
            <p className="text-body text-muted-foreground">End of results</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function filterCatalogItems(items: CatalogItem[], raw: string): CatalogItem[] {
  const needle = raw.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(needle)) return true;
    if (item.category.toLowerCase().includes(needle)) return true;
    const seller = item.seller?.displayName?.toLowerCase();
    return seller != null && seller.includes(needle);
  });
}
