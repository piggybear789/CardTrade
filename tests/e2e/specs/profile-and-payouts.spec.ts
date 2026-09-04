// tests/e2e/specs/profile-and-payouts.spec.ts
//
// Account surfaces. ONE page — `/profile`, titled "Settings" — with three tabs:
// Profile, Verification and Payouts. `/profile/payouts` is now a redirect onto
// `?tab=payouts`, kept for old links.
//
// THE TAB REFACTOR BROKE FOUR TESTS HERE, and the way it broke them is worth
// knowing before adding a fifth:
//
//   * The page title is "Settings", not "Profile". "Profile" survives only as a TAB
//     LABEL, which is a link, so `getByRole('heading', { name: 'Profile' })` matches
//     nothing at all.
//   * Section labels are NOT headings. `SettingsSection` renders its label through
//     `SectionLabel`, which is a `<p>` (components/account/SettingsPrimitives.tsx).
//     So "Payment method", "About", "Links", "Identity", "Payout account" and
//     "History" are all unreachable by `getByRole('heading')`. Only the real <h3>s
//     inside `PayoutsDashboard` — "Where your money goes", "Transfer history" — are
//     headings. Assert section labels as TEXT.
//   * Identity and payout setup moved to the VERIFICATION tab, and each section is
//     rendered ONLY when that half is unfinished. A fully set-up member sees neither
//     — just a "You're set up" row. An assertion that a status card is present is
//     therefore an assertion about seed state, not about the product.
//
// Two older traps that still apply:
//
//   1. `MarketplaceShell` renders the page title as an <h1> AND the page repeats it
//      as an <h2>. Every page title is a DUPLICATE — `.first()` is mandatory, not
//      defensive.
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

    // THE MEMBER'S NAME IS THE VISIBLE HEADING, and "Settings" is not on this page.
    // The account surface became a tab strip over a settings list: `MarketplaceShell`
    // owns the page `<h1>` and calls it "Account" (the rail and the document title used
    // to say "Settings", which is the name this test asserted and which no longer
    // renders anywhere), "Profile" is a tab, and the identity header above the tabs
    // carries the name as an `<h2>`. `.first()` because the shell heading and the
    // column heading can both match a member whose display name is generic.
    await expect(
      page.getByRole('heading', { name: ALICE.displayName }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The three tabs, asserted as the links they are. This is what tells us the
    // account surface rendered rather than an error state, and it is the one part of
    // the page that cannot move without the URLs moving too.
    const tabs = page.getByRole('navigation', { name: 'Account sections' });
    for (const label of ['Profile', 'Verification', 'Payouts']) {
      await expect(tabs.getByRole('link', { name: label })).toBeVisible();
    }

    // The row that holds the contact email, and the one that holds the card. Asserted
    // as rows rather than as group labels: the Profile tab carries no group headings
    // any more (the tab name is the heading), and its email row is labelled
    // "Name and email", not "Display name".

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
    // specs gives ALICE a card, so the label depends on which specs ran first, and
    // "Change card" matched nothing in either state. It passed only while the suite
    // happened to run in a lucky order.
    //
    // What is actually invariant is that the slot always offers a way to put a card on
    // file, and that its wording agrees with whether one is already there. Asserting
    // the pairing is a stronger check than either label alone, and it holds whichever
    // specs ran before this one.
    // ONE ROW, whose VALUE states which case we are in: "Add a card" when nothing is
    // on file, otherwise the saved card's own label. Asserting that pairing keeps the
    // check order-independent, which is the point the note above makes.
    //
    // NOT `^Add card$` / `^Replace$`. Those are `SavedCardRow`'s buttons, and that
    // component renders only in the trade surfaces (`ActionBar`, `TradeContract`,
    // `TradeNegotiationPanel`) — never on this page. On the Profile tab the card is a
    // single `SettingsListRow` acting as the `AddPaymentMethodDialog` trigger, so there
    // is one button, named for its label and value, and the empty-state sentence is its
    // row description rather than a separate placeholder.
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

      // NO RELOAD. The page must show the new name off the back of the action's own
      // revalidation.
      //
      // This assertion exists because it FAILED: `updateProfile` persisted the row
      // and returned ok, the editor closed with "Profile updated", and both the
      // details card and the rail kept the old name until a hard refresh. Reading
      // the name back after `page.reload()` would have passed against that bug and
      // proved only that the UPDATE statement ran.
      //
      // FILTERED TO THE VISIBLE COPY, because the name renders TWICE and one of them
      // is viewport-conditional: the account link carries `hidden … sm:inline`, so at
      // the mobile project's 390px it resolves but is never visible. `.first()` picked
      // exactly that one, which failed on mobile only — as "the name did not update"
      // when it had. Filtering keeps one honest assertion for both projects: on
      // desktop both copies are visible, on mobile only the details card is, and if
      // nothing updated there is no visible match and this still fails.
      await expect(
        page.getByText(edited).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
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

test.describe('Verification tab', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('discloses identity and payout setup independently', async ({ page }) => {
    await page.goto('/profile?tab=verification');
    await page.waitForLoadState('domcontentloaded');

    // THE SELECTED TAB IS THE ASSERTION, not a page title. `AccountTabs` sets
    // `aria-current="page"` on the active link, and that is what proves
    // `?tab=verification` resolved rather than falling back to Profile — which is the
    // failure this test would otherwise miss entirely. The old "Settings" heading it
    // used to look for does not render anywhere any more: the shell `<h1>` is
    // "Account" and the column `<h2>` is the member's name.
    await expect(
      page.getByRole('link', { name: 'Verification' }),
    ).toHaveAttribute('aria-current', 'page');

    // THE SEPARATION IS THE PRODUCT RULE (0069): the Identity_Gate and payout
    // readiness are independent, and a member may legitimately hold either without
    // the other. This asserts the SHAPE of that disclosure rather than the presence
    // of two named cards, because each setup section renders only while its half is
    // unfinished — so "both cards are visible" was an assertion about seed state, and
    // it would start failing the moment a seed member completed Connect onboarding.
    //
    // What must always hold: each half is offered only while it is unfinished, and
    // neither half's state is read off the other. Never a combined claim — that is the
    // 0060 mistake in UI form, where one row read "Verified Account" beside "Payouts
    // incomplete".
    //
    // MATCHED ON COPY UNIQUE TO EACH CARD, not on the section labels.
    //
    // "Identity" is NOT usable as a locator on any page: the rail renders a bare
    // `Identity` label in every marketplace view, so an exact text match finds it even
    // for a fully set-up member and reports the identity card as present when it is not
    // rendered at all. `Required before you can list, sell, or trade.` is
    // `IdentityCheckCard`'s own description, and `Payout destination` is
    // `PayoutOnboarding`'s — each appears only when that half still needs work.
    const identitySetup = page.getByText('Required before you can list, sell, or trade.');
    const payoutSetup = page.getByText('Payout destination');

    const identityPending = (await identitySetup.count()) > 0;
    const payoutPending = (await payoutSetup.count()) > 0;

    // Whichever halves are outstanding must actually be on screen, and a member with
    // nothing outstanding must be offered neither. Asserted this way rather than
    // against a single "all set up" sentence, because no such string exists in the
    // components today — see the note in the merge that produced this file.
    if (identityPending) await expect(identitySetup.first()).toBeVisible();
    if (payoutPending) await expect(payoutSetup.first()).toBeVisible();

    // THE INDEPENDENCE ITSELF (0069). A seeded member is identity-VERIFIED and
    // Connect-APPROVED, so neither half should be offered; if one is, the two facts
    // have been re-coupled or the gate regressed. Stated as an equality rather than
    // two absences so a failure names which half went wrong.
    expect(
      { identityPending, payoutPending },
      'a fully set-up member must be offered neither half of verification',
    ).toEqual({ identityPending: false, payoutPending: false });
  });
});

test.describe('Payouts tab', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('shows the release surfaces', async ({ page }) => {
    // Deliberately the LEGACY path: `/profile/payouts` is now a redirect onto
    // `?tab=payouts`, and entering through it proves old links still land on the
    // release surfaces rather than on the default tab.
    await page.goto('/profile/payouts');
    await page.waitForLoadState('domcontentloaded');

    // These two ARE real headings — <h3>s inside `PayoutsDashboard`, unlike the
    // section labels around them. See the file header.
    await expect(
      page.getByRole('heading', { name: 'Where your money goes' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /(Transfer history|No payouts yet)/ }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('shows the money buckets', async ({ page }) => {
    await page.goto('/profile?tab=payouts');
    await page.waitForLoadState('domcontentloaded');

    // The three buckets are a strict partition of a seller's proceeds, so all three
    // render together or the read model failed to load.
    //
    // `.first()` because "Owed to you" is stated twice on this tab — once as a StatTile
    // and once inside the balance card in `PayoutsDashboard` — which is a strict-mode
    // violation rather than a failure. Either instance proves the figure rendered.
    for (const label of ['Owed to you', 'Held for open sales', 'Under dispute']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});

test.describe('Identity demo controls', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('are not offered to a verified member', async ({ page }) => {
    // THE PRECONDITION IS ASSERTED, NOT ASSUMED. An absent crank only means something
    // once this member is known to be verified — otherwise the test passes on a page
    // that simply failed to render. Read off the rail's identity badge, which every
    // marketplace view carries.
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    // Filtered to the visible copy: "Verified" is stated both on the profile card's
    // pill and in the rail's identity badge, and the rail is desktop-only, so
    // `.first()` alone resolved to a hidden element on the mobile project.
    await expect(
      page.getByText('Verified', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ON THE VERIFICATION TAB, which is where identity moved. Pointing this at the
    // payouts surface passed for the wrong reason: the crank cannot render there at
    // all, so its absence proved nothing about the gate.
    await page.goto('/profile?tab=verification');
    await page.waitForLoadState('domcontentloaded');

    // WAIT FOR THE TAB, so the absence below is asserted against a rendered page
    // rather than an empty one. The selected-tab link is the signal; the "Settings"
    // heading this used to wait for no longer exists on the account surface.
    await expect(
      page.getByRole('link', { name: 'Verification' }),
    ).toHaveAttribute('aria-current', 'page', { timeout: 10_000 });

    // The demo crank exists to MOVE a check forward, so a VERIFIED member must not be
    // offered it.
    //
    // ABSENT, not hidden. The whole Identity section is conditional on
    // `!identityVerified`, so for a verified member neither the card nor the crank
    // inside it is rendered. Asserting the card is gone is what makes the crank's
    // absence meaningful: if either reappears, the gate has regressed to unverified.
    // Matched on the card's own description rather than on "Identity" — see the note
    // in the Verification tab test for why that word is unusable here.
    await expect(
      page.getByText('Required before you can list, sell, or trade.'),
    ).toHaveCount(0);
    await expect(page.getByLabel('Hackathon test mode controls')).toHaveCount(0);
  });
});
