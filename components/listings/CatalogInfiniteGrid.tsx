'use client';

// Infinite catalog at every width: append pages as the sentinel nears the
// viewport. There is no pager; a deep `?page=N` link still renders server-side
// and scrolling continues from it.

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Icon } from '@/components/ui/icon';
import { CircleNotchIcon } from '@/components/ui/icons';

import {
  fetchCatalogPage,
  type CatalogItem,
  type CatalogSort,
  type SearchCatalogParams,
} from '@/lib/actions/listings';
import {
  CatalogMosaic,
  catalogCoverDim,
} from '@/components/listings/CatalogMosaic';
import { CatalogItemCard } from '@/components/listings/ItemCard';

/** Hoisted: these are inputs to the mosaic's column balance, which is memoised. */
const itemKey = (item: CatalogItem) => item.id;
const itemCoverDim = (item: CatalogItem) => catalogCoverDim(item);

/**
 * How many covers are fetched eagerly instead of lazily.
 *
 * FOUR, BECAUSE THAT IS ONE ROW AT THE WIDEST LAYOUT. The grid is four columns
 * from `lg`, three at `md` and two on a phone, so four covers the first desktop
 * row and the first two phone rows — the tiles that are above the fold on every
 * viewport, and the set the Largest Contentful Paint element is drawn from.
 *
 * Counted in FEED order, which is the order that survives the mosaic:
 * `balanceMosaicColumns` walks items in rank order and drops each into whichever
 * column is shorter, so items 0 and 1 are the top of the two columns and 2 and 3
 * sit directly beneath them. Raising this past a row stops buying anything and
 * starts competing with itself for the same early bandwidth.
 */
const EAGER_COVER_COUNT = 4;

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
    includeReserved: boolean;
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
  // A replaced browse query resets the list DURING the render that carries the
  // new `revision`. That render is the provider's transition, so a fresh page
  // of tiles renders interruptibly. Resetting from an effect instead made it an
  // urgent update: a whole page of cards rendered in one blocking task right
  // after every pill tap.
  const [syncedRevision, setSyncedRevision] = useState(revision);
  if (syncedRevision !== revision) {
    setSyncedRevision(revision);
    setItems(initialItems);
    setPage(initialPage);
    setHasMore(initialHasMore);
    setWatchingIds(new Set(initialWatchingIds));
    setError(null);
  }
  // A set of ids rather than an index, because `CatalogMosaic`'s render prop
  // hands back the item and not its position.
  const eagerCoverIds = useMemo(
    () => new Set(items.slice(0, EAGER_COVER_COUNT).map(itemKey)),
    [items],
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
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
      includeReserved: q.includeReserved || undefined,
      sort: q.sort,
      regionCode: q.regionCode ?? undefined,
      page: nextPage,
    };

    try {
      const result = await fetchCatalogPage(params);
      if (!result.ok) {
        loadedPagesRef.current.delete(nextPage);
        setError('Could not load more listings. Tap to try again.');
        setLoadingMore(false);
        return;
      }

      // A transition, so the next page of cards renders in slices while the
      // member keeps scrolling. As an urgent update it was one long task per
      // page, right under the finger.
      startTransition(() => {
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
        setLoadingMore(false);
      });
    } catch {
      loadedPagesRef.current.delete(nextPage);
      setError('Could not load more listings. Tap to try again.');
      setLoadingMore(false);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Only `revision` — a new watchingIds array on an unrelated parent render
  // must not forget pages already appended.
  useEffect(() => {
    loadedPagesRef.current = new Set([initialPage]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      // A screen and a half ahead. At 320px a fling reached the bottom before
      // the next page had even been requested, and the member sat on
      // "Loading more…" for the whole round trip.
      { root: null, rootMargin: '150% 0px', threshold: 0 },
    );

    observer.observe(node);
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // An observer only fires when intersection CHANGES. On a tall desktop
  // viewport the sentinel can still be in range after a page lands, so nothing
  // would fire and the grid would stop short. Re-observing delivers a fresh
  // entry for the current position, which loads the next page if still needed.
  useEffect(() => {
    const node = sentinelRef.current;
    const observer = observerRef.current;
    if (!node || !observer || !hasMore || loadingMore || error) return;
    observer.unobserve(node);
    observer.observe(node);
  }, [items, hasMore, loadingMore, error]);

  return (
    <>
      <CatalogMosaic items={items} keyOf={itemKey} dimOf={itemCoverDim}>
        {/* No per-tile fade on filter changes: the grid swaps instantly. */}
        {(item, coverDim) => (
          <CatalogItemCard
            item={item}
            coverDim={coverDim}
            eager={eagerCoverIds.has(item.id)}
            initialWatching={
              currentUserId && item.owner_id !== currentUserId
                ? watchingIds.has(item.id)
                : undefined
            }
          />
        )}
      </CatalogMosaic>

      {/* Sentinel + status. The button is the fallback when the observer has
          not fired (or to retry after a failure). */}
      <div>
        <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
        {hasMore && !loadingMore && !error ? (
          <button
            type="button"
            onClick={() => void loadMoreRef.current({ force: true })}
            className="mt-snug h-10 w-full rounded-md border border-input bg-card px-group text-body font-medium text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:border-ring"
          >
            Load more listings
          </button>
        ) : null}
        {loadingMore || error ? (
          <div className="flex flex-col items-center gap-snug py-6" aria-live="polite">
            {loadingMore ? (
              <p className="flex items-center gap-snug text-body text-muted-foreground">
                <Icon icon={CircleNotchIcon} className="size-4 animate-spin" aria-hidden="true" />
                Loading more…
              </p>
            ) : null}
            {error ? (
              <button
                type="button"
                onClick={() => void loadMoreRef.current({ force: true })}
                className="rounded-md text-body font-medium text-foreground underline-offset-4 hover:underline border border-transparent focus:outline-none focus-visible:border-ring"
              >
                {error}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}