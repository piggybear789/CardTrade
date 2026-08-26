// Lets the header ask the mounted catalog to refetch in place. A real
// navigation remounts /listings (loading skeleton + every card image).

export const CATALOG_BROWSE_EVENT = 'noditto:catalog-browse';
const CATALOG_QUERY_EVENT = 'noditto:catalog-query';

export type CatalogBrowseDetail = Record<string, string | string[] | null>;

let subscriberCount = 0;

export function subscribeCatalogBrowse(
  onBrowse: (updates: CatalogBrowseDetail) => void,
): () => void {
  function handle(event: Event) {
    const detail = (event as CustomEvent<CatalogBrowseDetail>).detail;
    if (detail) onBrowse(detail);
  }
  subscriberCount += 1;
  window.addEventListener(CATALOG_BROWSE_EVENT, handle);
  return () => {
    subscriberCount -= 1;
    window.removeEventListener(CATALOG_BROWSE_EVENT, handle);
  };
}

/** True when a catalog page is listening and handled the update. */
export function requestCatalogBrowse(updates: CatalogBrowseDetail): boolean {
  if (typeof window === 'undefined' || subscriberCount === 0) return false;
  window.dispatchEvent(new CustomEvent(CATALOG_BROWSE_EVENT, { detail: updates }));
  return true;
}

/** Lets the header search field stay in sync when the catalog clears or rewrites `q`. */
export function notifyCatalogQuery(q: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CATALOG_QUERY_EVENT, { detail: { q } }));
}

export function subscribeCatalogQuery(onQuery: (q: string) => void): () => void {
  function handle(event: Event) {
    const q = (event as CustomEvent<{ q: string }>).detail?.q;
    if (typeof q === 'string') onQuery(q);
  }
  window.addEventListener(CATALOG_QUERY_EVENT, handle);
  return () => window.removeEventListener(CATALOG_QUERY_EVENT, handle);
}

const CATALOG_FILTERS_EVENT = 'noditto:catalog-filters';

/** Opens or closes the catalog refine sheet from chrome that sits outside CatalogView. */
export function requestCatalogFilters(open: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CATALOG_FILTERS_EVENT, { detail: { open } }),
  );
}

export function subscribeCatalogFilters(
  onOpen: (open: boolean) => void,
): () => void {
  function handle(event: Event) {
    const open = (event as CustomEvent<{ open: boolean }>).detail?.open;
    if (typeof open === 'boolean') onOpen(open);
  }
  window.addEventListener(CATALOG_FILTERS_EVENT, handle);
  return () => window.removeEventListener(CATALOG_FILTERS_EVENT, handle);
}
