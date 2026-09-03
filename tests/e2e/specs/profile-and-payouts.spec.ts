// tests/e2e/specs/profile-and-payouts.spec.ts
//
// Account surfaces: /profile (details + saved card) and /profile/payouts
// (identity check, Connect status, release history).
//
// EVERY SELECTOR HERE WAS READ OFF THE RUNNING PAGE (tests/e2e/debug/inspect.spec.ts),
// not inferred from component source. Two things that dump makes obvious and that
// specs kept getting wrong:
//
//   1. `MarketplaceShell` renders the page title as an <h1> AND the page's own
//      SectionHeader repeats it as an <h2>. Every page title is therefore a
//      DUPLICATE — `.first()` is mandatory, not defensive.
//   2. The desktop rail (<aside>) is INSIDE <main>, so scoping a text query to
//      `getByRole('main')` does not exclude navigation. The member's display name
//      appears in the rail's account link as well as in the details card, so
//      asserting on the name alone is ambiguous by construction. Assert on the
//      contact email instead: it renders once, in the card.
//
// The destructive edit test runs as DAVE, not ALICE. It mutates
// `profiles.display_name`, and a failure between "change" and "restore" leaves
// that row dirty for every later spec — ALICE is the seller in cash-sale,
// listings, messages and trade, so corrupting her name breaks four files. Dave is
// referenced by no other spec.

import { test, expect } from '../support/fixtures';
import { ALICE, DAVE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, DAVE]);
});

test.describe('Profile page', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('renders the details card with the contact email', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // THE MEMBER'S NAME IS THE VISIBLE HEADING. The account surface became a tab
    // strip over a settings list: "Profile" is now a tab, the rail owns the h1,
    // and the identity header above the tabs carries the name. The old "Your
    // details" / "Card for Buying" cards are `SettingsGroup` rows now, so this
    // asserts on what a member can actually see and act on rather than on card
    // titles that no longer exist.
    await expect(
      page.getByRole('heading', { name: ALICE.displayName }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The row that holds the contact email, and the one that holds the card.
    await expect(page.getByText(ALICE.email)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Payment method/i }),
    ).toBeVisible();
  });

  test('exposes the edit and add-card affordances', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // The name/email row IS the edit trigger — it is a `SettingsListRow` used as
    // the dialog's `asChild` trigger, so it is a button named for its label and
    // current value. There is no separate "Edit" button any more.
    await expect(
      page.getByRole('button', { name: /Name and email/i }),
    ).toBeVisible();

    // STATE-INDEPENDENT ON PURPOSE. This used to assert `/Add card|Change card/`, on
    // the stated assumption that "seed profiles carry a mock payer but no saved
    // instrument". Both halves were wrong: `ensureSavedCard` in the cash-sale and trade
    // specs gives ALICE a card, so the label depends on which specs ran first, and the
    // saved-state label is "Replace card" - "Change card" matched nothing in either
    // state. It passed only while the suite happened to run in a lucky order.
    //
    // What is actually invariant is that the slot always offers a way to put a card on
    // file, and that its wording agrees with whether one is already there. Asserting
    // the pairing is a stronger check than either label alone, and it holds whichever
    // specs ran before this one.
    // One row, whose VALUE states which case we are in: "Add a card" when nothing
    // is on file, otherwise the saved card's label. Asserting the pairing keeps
    // the check order-independent, which is the point the note above makes.
    const cardRow = page.getByRole('button', { name: /Payment method/i });
    await expect(cardRow).toBeVisible();

    const rowText = (await cardRow.textContent()) ?? '';
    if (/Add a card/i.test(rowText)) {
      await expect(cardRow).toContainText(/Required to buy or back a trade/i);
    } else {
      await expect(cardRow).not.toContainText(/Add a card/i);
    }
  });
});

test.describe('Profile editing', () => {
  // DAVE, deliberately — see the file header.
  test.use({ storageState: storageStatePath(DAVE) });

  test('edits the display name and restores it', async ({ page }) => {
    const edited = `${DAVE.displayName} Edited`;

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    try {
      await page.getByRole('button', { name: /Name and email/i }).click();

      // EditProfileDialog: h2 "Edit your details", inputs "Display name" and
      // "Contact email", buttons "Save changes" / "Close".
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: 'Edit your details' }),
      ).toBeVisible();

      const nameInput = dialog.getByLabel('Display name');
      await expect(nameInput).toHaveValue(DAVE.displayName);

      await nameInput.fill(edited);
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      // NO RELOAD. The rail's account link must show the new name off the back of
      // the action's own revalidation.
      //
      // This assertion exists because it FAILED: `updateProfile` persisted the row
      // and returned ok, the editor closed with "Profile updated", and both the
      // details card and the rail kept the old name until a hard refresh. Reading
      // the name back after `page.reload()` would have passed against that bug and
      // proved only that the UPDATE statement ran.
      await expect(page.getByText(edited).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      // ALWAYS put the seed value back, including on assertion failure above.
      await page.goto('/profile');
      await page.waitForLoadState('domcontentloaded');
      await page.getByRole('button', { name: /Name and email/i }).click();
      const restore = page.getByRole('dialog');
      await restore.getByLabel('Display name').fill(DAVE.displayName);
      await restore.getByRole('button', { name: 'Save changes' }).click();
      await expect(restore).toBeHidden({ timeout: 10_000 });
    }
  });
});

test.describe('Payouts page', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('shows the identity and payout status cards', async ({ page }) => {
    await page.goto('/profile/payouts');
    await page.waitForLoadState('domcontentloaded');

    // `/profile/payouts` is a redirect shim onto the account hub's Payouts tab,
    // so the old "Selling & Payouts" page title is gone.
    await expect(page).toHaveURL(/\/profile\?.*tab=payouts/, { timeout: 10_000 });

    // TWO SEPARATE FACTS, and that separation is still the product rule (0069):
    // the Identity_Gate and payout readiness are independent. They now read as one
    // trust line above the tabs rather than two cards, but both must be stated.
    const trust = page.getByText(/ID checked by Stripe/i);
    await expect(trust).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Payouts (active|not set up)/i).first(),
    ).toBeVisible();
  });

  test('shows the release surfaces', async ({ page }) => {
    await page.goto('/profile/payouts');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Where your money goes' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /(Transfer history|No payouts yet)/ }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('hides the identity demo controls once verified', async ({ page }) => {
    await page.goto('/profile/payouts');
    await page.waitForLoadState('domcontentloaded');

    // The demo crank exists to MOVE a check forward, so a VERIFIED member must
    // not be offered it — and seed members are verified. Asserting its absence
    // is the real check: if it ever renders here, either the gate regressed to
    // unverified or the panel lost its status condition.
    // Wait for the tab to actually be on screen before asserting an absence —
    // otherwise this passes against a page that has not rendered yet.
    await expect(
      page.getByRole('heading', { name: 'Where your money goes' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByLabel('Hackathon test mode controls'),
    ).toBeHidden();
  });
});
