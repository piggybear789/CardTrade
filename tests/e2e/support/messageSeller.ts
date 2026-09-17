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

/**
 * Send a first message to a seller from a listing page, at EITHER viewport, and
 * return the thread path it lands on.
 *
 * THE TWO VIEWPORTS DO THIS DIFFERENTLY, and that is the product's design rather
 * than a bug: desktop renders an inline compose row on the listing, while the
 * phone spends its bar width on Buy and offers a chat glyph that opens the thread
 * first. A helper that only knew the desktop shape reported the phone as broken.
 */
export async function messageSellerFromListing(
  page: Page,
  itemId: string,
  body: string,
): Promise<string> {
  const { expect } = await import('@playwright/test');
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const inline = messageSellerComposer(page);
  if (await inline.input.count()) {
    await expect(inline.input).toBeEnabled({ timeout: 15_000 });
    await inline.input.fill(body);
    await inline.send.click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: 30_000 });
    return new URL(page.url()).pathname;
  }

  // Phone: the glyph opens (or creates) the conversation, then the thread's own
  // composer carries the message.
  const open = page.getByRole('button', { name: 'Message seller' }).first();
  await expect(open).toBeEnabled({ timeout: 15_000 });
  await open.click();
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const composer = page.getByPlaceholder(/Write a message/i);
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill(body);

  // THE SEND IS AWAITED, NOT JUST OBSERVED.
  //
  // The thread paints the bubble optimistically, so every assertion after the click
  // passes before the row exists. A caller that then navigates — to the inbox, say —
  // aborts the in-flight Server Action and lands on a page that correctly reports an
  // empty conversation. That is a real defect in its own right (see F43), and it is
  // also the reason this helper cannot hand back control on the strength of a bubble.
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/messages/'),
      { timeout: 20_000 },
    ),
    page.getByRole('button', { name: /^Send message$/ }).click(),
  ]);
  // Scoped to the thread: a viewport wide enough to show the inbox beside the
  // conversation renders the body twice, once as the row's preview.
  await expect(page.getByLabel(/^Conversation with/).getByText(body)).toBeVisible({
    timeout: 15_000,
  });
  return new URL(page.url()).pathname;
}
