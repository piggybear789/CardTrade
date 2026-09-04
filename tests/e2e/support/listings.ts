// tests/e2e/support/listings.ts
//
// Creating a listing through the real form, shared by every spec that needs a
// throwaway item.
//
// WHY A HELPER RATHER THAN REUSING SEED ITEMS. Some flows change an item's status
// permanently: accepting an offer opens a Cash_Sale, which flips
// `items.status` to RESERVED, and nothing in the suite puts it back. A spec built
// on a seed item therefore passes exactly once and fails on every later run with
// "no longer available" — and it takes the catalog specs with it, because
// `items_catalog_select` treats availability as visibility, so the item silently
// leaves the catalog other tests assert on.
//
// So flows that consume an item create their own, marked, and teardown deletes it.
// Flows that only READ an item (browse, detail, messaging) use the seed fixtures.

import { expect, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { STUB_PLACES, stubbedPlaceLabel, type StubbedPlace } from './places';

/** 1×1 PNG. Listing images are required (1–10). */
const TEST_IMAGE = path.resolve(__dirname, '..', 'fixtures', 'test-image.png');

/**
 * Fill a `PlacePicker` by typing and choosing a suggestion.
 *
 * THE SUGGESTION MUST BE CHOSEN, not merely typed. `PlacePicker` only produces a
 * resolved `PlaceValue` when a prediction is selected; typing alone yields a `text:`
 * id, which `domain/fulfilment/terms.ts` refuses for a delivery address or meeting
 * point. Suggestions come from the intercepted Places stub, so this is deterministic
 * and offline — see tests/e2e/support/places.ts.
 *
 * `page` is taken explicitly rather than derived from a scope, because the field may
 * sit inside a dialog while the assertions still need the page. `PlaceSearch` renders
 * its list as `role="listbox"` containing `role="option"` items, in the same subtree
 * as the input — not portalled — so a dialog scope works for both.
 *
 * @param page  the page under test
 * @param label the field's visible label, e.g. /Based near/
 * @param place which stubbed place to pick; the query is derived from it
 * @param scope narrower root when the field is inside a dialog
 */
export async function fillPlace(
  page: Page,
  label: RegExp | string,
  place: StubbedPlace = STUB_PLACES.sydney,
  scope?: Locator,
): Promise<void> {
  const root = scope ?? page;
  const input = root.getByLabel(label).first();
  await expect(input).toBeEnabled({ timeout: 15_000 });

  const query = place.secondaryText.split(' ')[0];
  const option = root.getByRole('option').filter({ hasText: place.mainText }).first();

  // TYPED UP TO TWICE, BECAUSE FOCUS CAN BE STOLEN BETWEEN THE CLICK AND THE KEYSTROKES.
  //
  // `PlaceSearch` renders its list only while `open` is true and closes `open` on
  // blur, and a shadcn/Radix `Select` restores focus to its own trigger
  // asynchronously when it closes. Callers wait for that restore before coming here
  // (see `createListing`), but a second pass costs little and covers a restore that
  // lands late.
  //
  // `waitFor`, NOT `isVisible({ timeout })`. `Locator.isVisible()` is an INSTANT
  // check and ignores a timeout option, so an earlier version of this loop failed
  // both attempts in milliseconds and reported "no suggestion" while the list was
  // about to appear — a helper bug that read exactly like a broken intercept.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await input.click();
    await input.fill('');
    await input.fill(query);

    const appeared = await option
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) break;

    if (attempt === 2) {
      throw new Error(
        `No suggestion matching "${place.mainText}" for query "${query}". The Places ` +
          'stub answers both calls with 200, so check whether focus was stolen from the ' +
          'field (see tests/e2e/support/places.ts and the note above).',
      );
    }
  }

  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  // Selection is confirmed by the resolved label landing in the field. Typing alone
  // would leave the typed query here, so this assertion is what distinguishes a
  // resolved place from an unresolved one.
  await expect(input).toHaveValue(new RegExp(place.mainText), { timeout: 10_000 });
}

/** The label a picked stub place leaves in the field, for assertions. */
export { stubbedPlaceLabel, STUB_PLACES };

export interface CreateListingOptions {
  /**
   * Marked label — pass `marked(...)` so teardown can find the row.
   *
   * The form no longer HAS a Title field: it takes one description and the server
   * derives `items.title` from it via `deriveItemTitle`. This string is filled as the
   * OPENING of the description, so it still lands in `items.title` verbatim — it is
   * far shorter than the 80-character derivation budget — and cleanup keeps matching
   * on it.
   */
  title: string;
  /** Dollars, as typed into the form. Converted to integer cents by the form. */
  priceDollars?: string;
  description?: string;
}

/**
 * Fill the create-listing form and submit, returning the new item's detail URL.
 *
 * Field notes that are not guessable from the component source:
 *
 *  - Listing kind is a pair of radio tiles, matched by PREFIX on the label rather
 *    than by equality — the tiles carry no description now, but matching on a
 *    prefix means reinstating one would not break this helper. SINGLE is chosen
 *    because a SHOPFRONT is never reserved and never sold (0064) and so behaves
 *    differently in every downstream assertion.
 *  - Game / Condition are shadcn `Select`s. Radix renders the
 *    trigger AND a hidden native <select>, both labelled by the same
 *    `<Label htmlFor>`, so `getByLabel` is permanently ambiguous. The trigger
 *    carries the id, so `#game` / `#condition` are used.
 *  - `Based near` is REQUIRED. The suite runs with no Maps key so PlacePicker
 *    falls back to a plain text input — see playwright.config.ts.
 *  - The file input is visually hidden behind an "Add photos" button; the button
 *    only opens the OS picker, so the input is driven directly.
 */
export async function createListing(
  page: Page,
  { title, priceDollars = '50.00', description = 'Created by the e2e suite.' }: CreateListingOptions,
): Promise<string> {
  await page.goto('/listings/new');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('radio', { name: /^One item/ }).check();

  // SELECTS BEFORE TEXT FIELDS — order matters on WebKit (F61).
  //
  // Radix Select's hidden native <select> triggers a form-level side-effect on
  // WebKit that clears preceding controlled inputs. Selecting an option from any
  // of the dropdowns wipes the Title (and any other text field filled before
  // it). Filling text fields AFTER the selects avoids the issue entirely and keeps
  // the helper working on both Chromium (desktop) and WebKit (mobile).
  await page.locator('#game').click();
  await page.getByRole('option', { name: 'Pokémon' }).click();
  await page.locator('#condition').click();
  await page.getByRole('option', { name: 'Near Mint' }).click();

  // WAIT FOR THE SELECT TO HAND FOCUS BACK before touching anything else.
  //
  // A shadcn/Radix `Select` restores focus to its own trigger ASYNCHRONOUSLY after
  // closing. At automation speed that restore can land AFTER the next field has been
  // focused and typed into — which blurs it. For `Based near` that was fatal and
  // invisible: `PlaceSearch` closes its list on blur, so the Places request fired,
  // returned 200, and no suggestion ever rendered. Probed side by side in
  // tests/e2e/debug/places.spec.ts — `listbox=1` on a fresh form, `listbox=0` after
  // the selects, with identical successful responses.
  //
  // A human never hits it (the restore completes long before anyone clicks the next
  // field), so this is an automation artefact, not an app defect — hence a wait here
  // rather than a change to the component.
  await expect(page.locator('#condition')).toBeFocused({ timeout: 10_000 });

  // One prose field, and the marked label leads it so the derived title contains it.
  //
  // Matched EXACTLY on `Description`, which is what `ItemForm` labels it. This helper
  // previously looked for `Describe what you are selling`; that string now lives only
  // in the card's own `CardDescription` ("Describe your collectible and set its
  // price…"), which `getByLabel` cannot see. The miss cost 6 failures across three
  // lifecycles — cash-sale, trade and offers all reach escrow through this one line —
  // and every one of them surfaced as a 90s timeout on a field that renders fine.
  //
  // `exact` because a substring match would also accept a future second field whose
  // label merely CONTAINS "Description", and filling the wrong box here would fail
  // much later, at the derived title.
  await page
    .getByLabel('Description', { exact: true })
    .fill(`${title}. ${description}`);
  await page.getByLabel('Price').fill(priceDollars);

  // PLACE BEFORE PHOTOS, and the order matters.
  //
  // `setInputFiles` starts an upload to Supabase Storage. When it resolves it
  // re-renders `ItemForm`, which re-runs `PlaceSearch`'s search effect — and that
  // effect ABORTS the in-flight request on cleanup. Choosing the place while an
  // upload was settling therefore produced an empty suggestion list, intermittently
  // and with no error: the field held the typed query, no options appeared, and the
  // failure surfaced as "option not found" as though the intercept were broken. It
  // was not; the request had been cancelled.
  //
  // Filled through the real autocomplete rather than free text, so the value is a
  // RESOLVED place — which is what lets this listing later carry a contract (see
  // support/places.ts).
  await fillPlace(page, /Based near/, STUB_PLACES.sydney);

  await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  // Wait for the upload to land before submitting: the action is given object paths,
  // not bytes, so submitting early sends an incomplete image list.
  await expect(page.getByText(/1 selected/i)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Create listing' }).click();

  // 45s, not 30s. Publishing uploads to Storage, writes the row and then navigates to
  // the new listing, and the mobile project emulates a phone — the same sequence that
  // finishes well inside 30s on desktop repeatedly missed it there, which surfaced as
  // "the form does not submit" when the form was submitting and the test gave up.
  await expect(page).toHaveURL(/\/listings\/[0-9a-f-]{36}/, { timeout: 45_000 });
  return page.url();
}

/** The item id out of a detail URL produced by {@link createListing}. */
export function itemIdFromUrl(url: string): string {
  const id = new URL(url).pathname.split('/').pop();
  if (!id) throw new Error(`No item id in ${url}`);
  return id;
}
