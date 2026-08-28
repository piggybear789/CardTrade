// tests/e2e/support/messageSeller.ts
//
// The inline "message the seller" composer on a listing page.
//
// WHY A HELPER AND NOT `getByLabel` DIRECTLY. The listing page renders the
// composer TWICE — `renderListingActions` is called once inside the `lg:hidden`
// phone stack and once inside `ListingDesktopPane` — so both instances are in
// the DOM at every viewport and CSS decides which one is on screen. Addressing
// them by label or role alone therefore matches two elements and trips strict
// mode.
//
// It used to match only one, for the wrong reason: `MessageSellerButton`
// hardcoded `id="message-seller-input"`, so the document carried that id twice
// and BOTH labels resolved to whichever came first — the phone copy. On a
// desktop viewport that copy is `display:none`, which is why this spec failed
// with "element is not visible" rather than a strict-mode violation. The
// component now derives the id with `useId()`, so both labels work and the
// visibility filter is what picks the right one.

import type { Locator, Page } from '@playwright/test';

export interface MessageSellerComposer {
  /** The text input, scoped to the instance on screen. */
  input: Locator;
  /** Its submit button, scoped the same way. */
  send: Locator;
}

export function messageSellerComposer(page: Page): MessageSellerComposer {
  return {
    input: page.getByLabel('Send seller a message').filter({ visible: true }),
    send: page.getByRole('button', { name: 'Send' }).filter({ visible: true }),
  };
}
