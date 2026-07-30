'use client';

// Mobile infinite catalog: append pages as the sentinel enters the viewport.
// Desktop keeps URL pagination (the page nav is rendered by the server parent).

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  fetchCatalogPage,
  type CatalogItem,
  type CatalogSort,
  type SearchCatalogParams,
} from '@/lib/actions/listings';
import { ItemCard } from '@/components/listings/ItemCard';

const MOBILE_MAX = '(max-width: 1023px)';

export interface CatalogInfiniteGridProps {
  initialItems: CatalogItem[];
  initialPage: number;
  initialHasMore: boolean;
  currentUserId: string | null;
  initialWatchingIds: string[];
  query: {
    q: string;
    categories: string[];
    minCents?: number;
    maxCents?: number;
    verifiedOnly: boolean;
    includeSold: boolean;
    sort: CatalogSort;
  };
}

export function CatalogInfiniteGrid({
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
      minCents: q.minCents,
      maxCents: q.maxCents,
      verifiedOnly: q.verifiedOnly || undefined,
      includeSold: q.includeSold || undefined,
      sort: q.sort,
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
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            variant="catalog"
            initialWatching={
              currentUserId && item.owner_id !== currentUserId
                ? watchingIds.has(item.id)
                : undefined
            }
          />
        ))}
      </div>

      {/* Sentinel + status — mobile only; desktop uses the page nav below. */}
      <div className="lg:hidden">
        <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
        <div className="flex flex-col items-center gap-2 py-6" aria-live="polite">
          {loadingMore ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading more…
            </p>
          ) : null}
          {error ? (
            <button
              type="button"
              onClick={() => void loadMoreRef.current({ force: true })}
              className="rounded-md text-sm font-medium text-foreground underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {error}
            </button>
          ) : null}
          {!hasMore && !loadingMore && items.length > 0 ? (
            <p className="text-sm text-muted-foreground">End of results</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
