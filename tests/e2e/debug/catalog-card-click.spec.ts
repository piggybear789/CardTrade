// tests/e2e/debug/catalog-card-click.spec.ts
//
// PROBE, not a guarantee. The guest journey found that clicking a catalog tile on
// desktop left the URL on the catalog, with no Playwright error — the click landed
// on a real anchor and nothing navigated. This isolates why: what is actually on
// top at the click point, whether the anchor is the event target, and what the page
// reports while the click happens.

import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing } from '../support/listings';
import { marked } from '../support/marker';

test.describe('catalog tile click', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test('probe', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const token = `probe${Date.now().toString(36)}`;
    await createListing(page, { title: marked(`catalog click ${token}`) });

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) =>
      errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`),
    );

    await page.goto(`/?q=${token}`);
    await page.waitForLoadState('domcontentloaded');

    const card = page.getByRole('link', { name: new RegExp(token, 'i') }).first();
    await expect(card).toBeVisible();

    const probe = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const chain: string[] = [];
      let node: Element | null = top;
      while (node && chain.length < 6) {
        chain.push(
          `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? `.${node.className.split(/\s+/).slice(0, 3).join('.')}` : ''}`,
        );
        node = node.parentElement;
      }
      return {
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        href: (element as HTMLAnchorElement).href,
        pointerEvents: getComputedStyle(element).pointerEvents,
        topAtCentre: chain,
        topIsAnchorOrChild:
          top === element || Boolean(element.contains(top)) || Boolean(top?.contains(element)),
      };
    });
    console.log('PROBE', JSON.stringify(probe, null, 2));

    // Record the real event sequence, so a swallowed click can be told apart from a
    // click that never happened.
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __clickLog: string[] }).__clickLog = log;
      const describe = (event: Event) => {
        const target = event.target as Element | null;
        return `${event.type} target=${target?.tagName.toLowerCase()}${
          target && 'className' in target && typeof target.className === 'string'
            ? `.${target.className.split(/\s+/).slice(0, 2).join('.')}`
            : ''
        } phase=${event.eventPhase} prevented=${event.defaultPrevented}`;
      };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        document.addEventListener(type, (event) => log.push(describe(event)), true);
        document.addEventListener(type, (event) => log.push(`bubble ${describe(event)}`));
      }
      window.addEventListener('beforeunload', () => log.push('beforeunload'));
    });

    // What the browser does with a real click, observed rather than asserted.
    const before = page.url();
    await card.click();
    await page.waitForTimeout(4_000);
    console.log('PROBE url before/after', before, '->', page.url());
    console.log(
      'PROBE events',
      JSON.stringify(
        await page
          .evaluate(() => (window as unknown as { __clickLog?: string[] }).__clickLog ?? [])
          .catch(() => ['(context destroyed — it navigated)']),
        null,
        2,
      ),
    );

    // And what a plain anchor activation does, bypassing pointer geometry entirely.
    if (page.url() === before) {
      await card.evaluate((element) => (element as HTMLAnchorElement).click());
      await page.waitForTimeout(4_000);
      console.log('PROBE after el.click()', page.url());
    }

    console.log('PROBE diagnostics', JSON.stringify(errors, null, 2));

    // THE CONDITION THE JOURNEY ACTUALLY FAILED UNDER: a guest, and a click fired
    // the instant the tile is visible rather than after four seconds of settling.
    const guest = await page.context().browser()!.newContext();
    const guestPage = await guest.newPage();
    try {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const settle = attempt % 2 === 0;
        await guestPage.goto(`/?q=${token}`);
        await guestPage.waitForLoadState('domcontentloaded');
        const guestCard = guestPage
          .getByRole('link', { name: new RegExp(token, 'i') })
          .first();
        await expect(guestCard).toBeVisible();
        await guestPage.evaluate(() => {
          const log: string[] = [];
          (window as unknown as { __clickLog: string[] }).__clickLog = log;
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            document.addEventListener(
              type,
              (event) => {
                const target = event.target as Element | null;
                log.push(
                  `${event.type} target=${target?.tagName.toLowerCase()} connected=${target?.isConnected} prevented=${event.defaultPrevented}`,
                );
              },
              true,
            );
            document.addEventListener(type, (event) =>
              log.push(`bubble ${event.type} prevented=${event.defaultPrevented}`),
            );
          }
        });
        if (settle) await guestPage.waitForTimeout(3_000);
        const from = guestPage.url();
        await guestCard.click();
        await guestPage.waitForTimeout(3_000);
        const navigated = from !== guestPage.url();
        console.log(
          `PROBE guest attempt ${attempt} settle=${settle}`,
          navigated ? `-> ${guestPage.url()}` : 'NO NAVIGATION',
        );
        if (!navigated) {
          console.log(
            'PROBE guest events',
            JSON.stringify(
              await guestPage.evaluate(
                () => (window as unknown as { __clickLog?: string[] }).__clickLog ?? [],
              ),
            ),
          );
        }
      }
    } finally {
      await guest.close();
    }
  });
});
