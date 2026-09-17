// tests/e2e/debug/header-and-edit.spec.ts
//
// Two measurements the screenshot matrix could see but not name:
//   F42 — the desktop wordmark and the first nav item read as "NoDittoMarketplace".
//         The source says there is a 12px gap plus the button's own padding, so the
//         gap has to be measured rather than reasoned about.
//   F41 — one button on `/listings/[id]/edit` has no accessible name. This prints
//         which one.

import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';

test.describe('header spacing and edit-form labelling', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test('probe', async ({ page }) => {
    test.setTimeout(6 * 60_000);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const header = await page.evaluate(() => {
      const brand = document.querySelector('a[aria-label="NoDitto home"]');
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const firstLink = nav?.querySelector('a');
      const wordmark = Array.from(brand?.querySelectorAll('span') ?? []).find(
        (span) => span.textContent?.trim() === 'NoDitto',
      );
      const box = (element: Element | null | undefined) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      const styles = (element: Element | null | undefined) =>
        element
          ? {
              padding: getComputedStyle(element).padding,
              margin: getComputedStyle(element).margin,
            }
          : null;
      return {
        brand: box(brand),
        wordmark: box(wordmark),
        nav: box(nav),
        firstLink: box(firstLink),
        firstLinkText: firstLink?.textContent?.trim(),
        firstLinkStyles: styles(firstLink),
        navParentGap: brand?.parentElement
          ? getComputedStyle(brand.parentElement).gap
          : null,
        inkGap:
          wordmark && firstLink
            ? firstLink.getBoundingClientRect().left -
              wordmark.getBoundingClientRect().right
            : null,
      };
    });
    console.log('PROBE header', JSON.stringify(header, null, 2));

    const url = await createListing(page, { title: marked(`edit label ${Date.now()}`) });
    await page.goto(`/listings/${itemIdFromUrl(url)}/edit`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /Save|Update/i }).first()).toBeVisible({
      timeout: 30_000,
    });

    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((button) => {
          const name =
            button.getAttribute('aria-label') ??
            button.getAttribute('title') ??
            button.textContent?.trim() ??
            '';
          return name === '';
        })
        .map((button) => ({
          className: button.className,
          type: button.getAttribute('type'),
          html: button.outerHTML.slice(0, 400),
          parent: button.parentElement?.className ?? null,
          visible: button.getBoundingClientRect().width > 0,
        })),
    );
    console.log('PROBE unnamed buttons', JSON.stringify(unnamed, null, 2));
  });
});
