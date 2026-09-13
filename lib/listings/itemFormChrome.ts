// Lets the listing compose form tell the phone header it may submit.
//
// The header is a sibling ABOVE the page, so the Sell control cannot take
// props or context from ItemForm. Same store shape as listingChrome: the
// header may mount after the form has already published.

export const ITEM_FORM_ID = 'listing-item-form';

export type ItemFormChromeContext = {
  submitting: boolean;
  /**
   * The submit control's resting label — "Create listing" or "Save changes".
   *
   * Published by the form rather than derived in the header, because the form is
   * the thing that knows which mode it is in. The header only knew about `/new`
   * when this was create-only, and an edit chrome guessing the label would be a
   * second place that mapping lives.
   */
  label: string;
};

let current: ItemFormChromeContext | null = null;
const listeners = new Set<() => void>();

function same(a: ItemFormChromeContext | null, b: ItemFormChromeContext | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.submitting === b.submitting && a.label === b.label;
}

export function publishItemFormChrome(next: ItemFormChromeContext | null) {
  if (same(current, next)) return;
  current = next;
  for (const notify of listeners) notify();
}

export function subscribeItemFormChrome(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getItemFormChrome(): ItemFormChromeContext | null {
  return current;
}

export function getItemFormChromeServerSnapshot(): ItemFormChromeContext | null {
  return null;
}
