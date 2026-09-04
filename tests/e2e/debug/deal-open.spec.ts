// tests/e2e/debug/deal-open.spec.ts
//
// PROBE, not a guard. Kept as the record of how the compose-dialog tile failure was
// diagnosed, and as the thing to re-run if it comes back.
//
// The main config's `desktop`/`mobile` projects match `specs/*.spec.ts` only, so
// nothing here runs in a normal suite. To run it, point the debug config at it:
//
//   npx playwright test --config=playwright.debug.config.ts deal-open
//
// NOTE: that config serves `next dev`, which shares `.next` with a production build
// and will invalidate one — rebuild before the next `test:e2e:prod`.
//
// WHAT IT ESTABLISHED. private-deal.spec.ts saw the "Start a Deal" heading appear and
// then timed out on the first radio, which reads as the dialog being torn down by the
// `?deal=1` strip. It is not:
//
//   * `/deals/new` server-redirects to `/?deal=1`; the dialog opens and is STEADY from
//     ~900ms — dialogs=1, radios=1, visible, at a CONSTANT 1x1 box.
//   * `ChoiceTile` renders radios `sr-only`, so actionability passes and the HIT TEST
//     fails: at the input's own coordinates the topmost element is a sibling `<span>`.
//     Playwright retries the whole loop, printing "waiting for element to be visible,
//     enabled and stable" as though the control had never rendered.
//   * Measured here: `check()` times out; `check({ force: true })`, clicking the
//     `<label>` and clicking the tile text all select it.
//
// The fix is `chooseTile` in tests/e2e/support/deals.ts, which clicks the label.
//
// A first version of this probe used `page.evaluate` and died with "Execution context
// was destroyed, most likely because of a navigation" — the `router.replace` that
// strips `?deal=1`. Locators survive it; evaluate does not.
import { test, expect } from '@playwright/test';
import { ALICE, storageStatePath } from '../support/users';

test.use({ storageState: storageStatePath(ALICE) });

const STRATEGIES: Array<
  [string, (page: import('@playwright/test').Page) => Promise<void>]
> = [
  [
    'radio.check()',
    (p) => p.getByRole('radio', { name: /Cash for a card/i }).check({ timeout: 4000 }),
  ],
  [
    'radio.check({force})',
    (p) =>
      p
        .getByRole('radio', { name: /Cash for a card/i })
        .check({ force: true, timeout: 4000 }),
  ],
  [
    'label.click()',
    (p) => p.locator('label', { hasText: 'Cash for a card' }).first().click({ timeout: 4000 }),
  ],
  [
    'getByText().click()',
    (p) => p.getByText('Cash for a card', { exact: true }).click({ timeout: 4000 }),
  ],
];

for (const [name, act] of STRATEGIES) {
  test(`select the cash tile via ${name}`, async ({ page }) => {
    await page.goto('/deals/new');
    const radio = page.getByRole('radio', { name: /Cash for a card/i });
    await expect(radio).toHaveCount(1, { timeout: 20_000 });

    try {
      await act(page);
    } catch (error) {
      console.log(`RESULT ${name}: THREW ${(error as Error).message.split('\n')[0]}`);
      return;
    }
    console.log(`RESULT ${name}: acted, checked=${await radio.isChecked()}`);
  });
}
