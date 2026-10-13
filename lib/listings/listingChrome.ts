// Lets the listing page tell the phone header what it may render.
//
// The header is a sibling ABOVE the page content, not an ancestor of it, so
// props and context cannot reach it — the same direction-of-travel problem
// `lib/catalog/browseEvents.ts` solves for the catalog refine sheet. Share got
// away without this because it only ever reads `window.location.href`. Report
// cannot: whether it may be offered depends on the viewer being signed in and
// NOT being the owner, and only the page has done that work.
//
// A store rather than a bare event, because the header may mount or re-render
// after the page has already published, and an event fired once would be lost.

export type ListingChromeContext = {
  itemId: string;
  /** Signed in, and not this listing's owner. Never a substitute for the
   *  server-side self-report guard in `reportItem`. */
  canReport: boolean;
};

let current: ListingChromeContext | null = null;
const listeners = new Set<() => void>();

function same(a: ListingChromeContext | null, b: ListingChromeContext | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.itemId === b.itemId && a.canReport === b.canReport;
}

export function publishListingChrome(next: ListingChromeContext | null) {
  if (same(current, next)) return;
  current = next;
  for (const notify of listeners) notify();
}

export function subscribeListingChrome(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getListingChrome(): ListingChromeContext | null {
  return current;
}

/**
 * The header renders before any page has published, so the server snapshot is
 * always empty. Report fades in on hydration rather than being server-rendered.
 */
export function getListingChromeServerSnapshot(): ListingChromeContext | null {
  return null;
}
