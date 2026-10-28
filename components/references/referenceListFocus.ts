// components/references/referenceListFocus.ts
//
// Where focus goes after a reference card disappears (withdrawn by its author, removed
// by staff). The button that was pressed lives on that card, so once the refreshed page
// drops it, focus would fall back to the document body and a keyboard or screen-reader
// user would be thrown to the top of the page. It goes to the list's heading instead.

/** The id of the "References received / given" heading above the cards. */
export const REFERENCE_LIST_HEADING_ID = 'reference-list-heading';

/** Focus the list heading once the refresh has replaced the cards. */
export function focusReferenceList(): void {
  // Two frames: the refresh commits on the next render, after which the heading is the
  // nearest stable thing on the page.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.getElementById(REFERENCE_LIST_HEADING_ID)?.focus()),
  );
}
