// tests/e2e/debug/inspect.spec.ts
//
// NOT PART OF THE SUITE. A development tool: it visits a page as a given seed
// user and prints the accessibility tree plus every interactive element's
// accessible name, so specs are written against what the page actually renders
// rather than against what its source looked like it would render.
//
// Run one at a time:
//   npx playwright test --config=playwright.debug.config.ts --grep "profile"
//
// Every test here PASSES by design — the output is the product, not the result.
import { test, expect } from '../support/fixtures';
import { ALICE, BOB, CAROL, DAVE, ERIN, storageStatePath } from '../support/users';
import { createListing } from '../support/listings';

/** Dump headings, buttons, links, inputs and dialogs with their accessible names. */
async function dumpPage(page: import('@playwright/test').Page, label: string) {
  await page.waitForLoadState('domcontentloaded');

  const report = await page.evaluate(() => {
    const accessibleName = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const names = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean);
        if (names.length) return names.join(' ');
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label?.textContent) return label.textContent.trim();
        }
        const wrapping = el.closest('label');
        if (wrapping?.textContent) return wrapping.textContent.trim();
        if (el instanceof HTMLInputElement && el.placeholder) return `[placeholder] ${el.placeholder}`;
      }
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
    };

    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        (rect.width > 0 || rect.height > 0 || el.classList.contains('sr-only'))
      );
    };

    const collect = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .filter(visible)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: accessibleName(el),
          srOnly: el.classList.contains('sr-only'),
          disabled: (el as HTMLButtonElement).disabled ?? false,
        }));

    return {
      url: location.pathname + location.search,
      title: document.title,
      headings: collect('h1, h2, h3, h4, [role="heading"]'),
      buttons: collect('button, [role="button"]'),
      links: collect('a[href]'),
      inputs: collect('input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"]'),
      dialogs: collect('[role="dialog"], dialog'),
      landmarks: collect('main, [role="main"], nav, [role="navigation"], aside'),
    };
  });

  const dupes = (rows: { name: string }[]) => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1);
  };

  const section = (heading: string, rows: { tag: string; name: string; srOnly?: boolean; disabled?: boolean }[]) => {
    const lines = rows.map(
      (r) =>
        `    ${r.tag.padEnd(8)} "${r.name}"${r.srOnly ? '  [sr-only]' : ''}${r.disabled ? '  [disabled]' : ''}`,
    );
    const d = dupes(rows);
    if (d.length) {
      lines.push(`    !! DUPLICATE NAMES (need .first()): ${d.map(([n, c]) => `"${n}" x${c}`).join(', ')}`);
    }
    return `  ${heading} (${rows.length})\n${lines.join('\n') || '    —'}`;
  };

  console.log(
    [
      '',
      '='.repeat(78),
      `PAGE: ${label}   ->   ${report.url}`,
      `TITLE: ${report.title}`,
      '='.repeat(78),
      section('LANDMARKS', report.landmarks),
      section('HEADINGS', report.headings),
      section('BUTTONS', report.buttons),
      section('INPUTS', report.inputs),
      section('DIALOGS', report.dialogs),
      section('LINKS', report.links.slice(0, 40)),
      '='.repeat(78),
      '',
    ].join('\n'),
  );
}

const ALICE_ITEM = 'aaaaaaa1-0000-0000-0000-000000000001';
const BOB_ITEM = 'aaaaaaa2-0000-0000-0000-000000000002';
const ERIN_ITEM = 'cccccccc-0000-0000-0000-000000000001';

test.describe('inspect as alice', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('mark all read behaviour', async ({ page, browser }) => {
    // Create a guaranteed-unread notification first: Bob messages Alice.
    const bob = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bob.newPage();
    await bobPage.goto(`/listings/${ALICE_ITEM}`);
    await bobPage.waitForLoadState('domcontentloaded');
    const c = bobPage.getByLabel('Send seller a message');
    await c.fill(`[E2E] bell probe ${Date.now()}`);
    await bobPage.getByRole('button', { name: 'Send' }).click();
    await bobPage.waitForURL(/\/messages\//, { timeout: 30_000 }).catch(() => {});
    await bob.close();

    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');

    const bells = () => page.getByRole('button', { name: /^Notifications/ });
    const names = async () => {
      const n = await bells().count();
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const b = bells().nth(i);
        out.push(`${await b.getAttribute('aria-label')} | visible=${await b.isVisible()}`);
      }
      return out;
    };

    console.log('--- bells BEFORE:', JSON.stringify(await names(), null, 1));

    const markAll = page.getByRole('button', { name: 'Mark all read' });
    console.log('--- markAll enabled BEFORE:', await markAll.isEnabled());
    await markAll.click();
    await page.waitForTimeout(6000);
    console.log('--- markAll enabled AFTER:', await markAll.isEnabled());
    console.log('--- bells AFTER click:', JSON.stringify(await names(), null, 1));

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    console.log('--- bells AFTER reload:', JSON.stringify(await names(), null, 1));
  });

  test('profile', async ({ page }) => {
    await page.goto('/profile');
    await dumpPage(page, 'profile');
  });

  test('profile edit dialog', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    const edit = page.getByRole('button', { name: /edit/i }).first();
    if (await edit.isVisible().catch(() => false)) {
      await edit.click();
      await page.waitForTimeout(600);
    }
    await dumpPage(page, 'profile + edit dialog open');
  });

  test('payouts', async ({ page }) => {
    await page.goto('/profile/payouts');
    await dumpPage(page, 'profile/payouts');
  });

  test('messages', async ({ page }) => {
    await page.goto('/messages');
    await dumpPage(page, 'messages');
  });

  test('notifications', async ({ page }) => {
    await page.goto('/notifications');
    await dumpPage(page, 'notifications');
  });

  test('listings new', async ({ page }) => {
    await page.goto('/listings/new');
    await dumpPage(page, 'listings/new');
  });

  test('my listings', async ({ page }) => {
    await page.goto('/listings/mine');
    await dumpPage(page, 'listings/mine');
  });

  test('own item detail', async ({ page }) => {
    await page.goto(`/listings/${ALICE_ITEM}`);
    await dumpPage(page, 'own item detail');
  });

  test('offers', async ({ page }) => {
    await page.goto('/offers');
    await dumpPage(page, 'offers');
  });

  test('trades', async ({ page }) => {
    await page.goto('/trades');
    await dumpPage(page, 'trades');
  });

  test('sales', async ({ page }) => {
    await page.goto('/sales');
    await dumpPage(page, 'sales');
  });

  test('bob item as alice - trade entry', async ({ page }) => {
    await page.goto(`/listings/${BOB_ITEM}`);
    await dumpPage(page, "bob's item viewed by alice");
  });

  test('propose trade dialog', async ({ page }) => {
    await page.goto(`/listings/${BOB_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    const trigger = page.getByRole('button', { name: /trade/i }).first();
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
      await page.waitForTimeout(800);
    }
    await dumpPage(page, 'propose trade dialog open');
  });
});

test.describe('inspect as bob', () => {
  test.use({ storageState: storageStatePath(BOB) });

  test('alice item as bob - buy entry', async ({ page }) => {
    await page.goto(`/listings/${ALICE_ITEM}`);
    await dumpPage(page, "alice's item viewed by bob");
  });

  test('send message from listing', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const failedRequests: string[] = [];
    page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    const serverErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    await page.goto(`/listings/${ALICE_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    const composer = page.getByLabel('Send seller a message');
    await composer.fill('[E2E] inspector probe');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForTimeout(8000);

    console.log('--- url after send:', new URL(page.url()).pathname);
    console.log('--- composer disabled:', await composer.isDisabled().catch(() => 'n/a'));
    const alertText = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    console.log('--- role=alert text:', JSON.stringify(alertText));
    console.log('--- console errors:', JSON.stringify(consoleErrors.slice(0, 6), null, 2));
    console.log('--- failed requests:', JSON.stringify(failedRequests.slice(0, 6), null, 2));
    console.log('--- >=400 responses:', JSON.stringify(serverErrors.slice(0, 6), null, 2));
  });

  test('buy dialog after saving demo card', async ({ page }) => {
    await page.goto(`/listings/${ALICE_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Buy now' }).click();
    await page.waitForTimeout(2500);
    const saveCard = page.getByRole('button', { name: /save demo card/i });
    if (await saveCard.isVisible().catch(() => false)) {
      console.log('--- clicking "Save demo card"');
      await saveCard.click();
      await page.waitForTimeout(4000);
    } else {
      console.log('--- no demo card button; a method is already saved');
    }
    await dumpPage(page, 'buy dialog after card saved');
  });

  test('buy dialog', async ({ page }) => {
    await page.goto(`/listings/${ALICE_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    const buy = page.getByRole('button', { name: /buy now|ask for cards/i }).first();
    if (await buy.isVisible().catch(() => false)) {
      await buy.click();
      await page.waitForTimeout(2500); // payment-method lookup
    }
    await dumpPage(page, 'buy dialog open');
  });
});

test.describe('inspect as carol', () => {
  test.use({ storageState: storageStatePath(CAROL) });

  test('erin item as carol - offer entry', async ({ page }) => {
    await page.goto(`/listings/${ERIN_ITEM}`);
    await dumpPage(page, "erin's item viewed by carol");
  });

  test('make offer dialog', async ({ page }) => {
    await page.goto(`/listings/${ERIN_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    const offer = page.getByRole('button', { name: /offer/i }).first();
    if (await offer.isVisible().catch(() => false)) {
      await offer.click();
      await page.waitForTimeout(800);
    }
    await dumpPage(page, 'make offer dialog open');
  });

  test('accept confirmation dialog', async ({ page, browser }) => {
    // Alice lists, Carol offers, Alice counters, then Carol's Accept is probed.
    const alice = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const ap = await alice.newPage();
    const title = `[E2E] accept probe ${Date.now()}`;
    await ap.goto('/listings/new');
    await ap.waitForLoadState('domcontentloaded');
    await ap.getByRole('radio', { name: /^One item/ }).check();
    await ap.getByLabel('Title').fill(title);
    await ap.getByLabel('Description').fill('probe');
    await ap.locator('#game').click();
    await ap.getByRole('option', { name: 'Pokémon' }).click();
    await ap.locator('#condition').click();
    await ap.getByRole('option', { name: 'Near Mint' }).click();
    await ap.getByLabel('Price').fill('80.00');
    await ap.locator('input[type="file"]').first().setInputFiles(
      require('node:path').resolve(__dirname, '..', 'fixtures', 'test-image.png'),
    );
    await ap.getByLabel(/Based near/).fill('Sydney NSW');
    await ap.getByRole('button', { name: 'Create listing' }).click();
    await ap.waitForURL(/\/listings\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const probeItem = new URL(ap.url()).pathname.split('/').pop()!;

    // Carol offers.
    await page.goto(`/listings/${probeItem}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Make an offer' }).click();
    const od = page.getByRole('dialog');
    await od.getByRole('checkbox').check();
    await od.getByLabel('Your offer').fill('60.00');
    await od.getByLabel(/Message/i).fill('[E2E] accept probe offer');
    await od.getByRole('button', { name: 'Send offer' }).click();
    await page.waitForURL(/\/offers/, { timeout: 30_000 });

    // Alice counters.
    await ap.goto('/offers');
    await ap.waitForLoadState('domcontentloaded');
    await ap.getByRole('button', { name: 'Counter' }).first().click();
    const cd = ap.getByRole('dialog');
    await cd.getByLabel('Your counter').fill('70.00');
    await cd.getByLabel(/Message/i).fill('[E2E] accept probe counter');
    await cd.getByRole('button', { name: 'Send counter' }).click();
    await ap.waitForTimeout(4000);
    await alice.close();

    // Carol accepts — this is the bit being probed.
    await page.goto('/offers');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.waitForTimeout(2500);
    console.log('--- url after Accept:', new URL(page.url()).pathname);
    await dumpPage(page, 'after clicking Accept (buyer)');
  });

  test('counter and accept dialogs', async ({ page, browser }) => {
    // Carol offers on Erin's penny.
    await page.goto(`/listings/${ERIN_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Make an offer' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('checkbox').check();
    await d.getByLabel('Your offer').fill('41.00');
    await d.getByLabel(/Message/i).fill('[E2E] probe counter');
    await d.getByRole('button', { name: 'Send offer' }).click();
    await page.waitForURL(/\/offers/, { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    // Erin counters.
    const erin = await browser.newContext({ storageState: storageStatePath(ERIN) });
    const ep = await erin.newPage();
    await ep.goto('/offers');
    await ep.waitForLoadState('domcontentloaded');
    await ep.getByRole('button', { name: 'Counter' }).first().click();
    await ep.waitForTimeout(1200);
    await dumpPage(ep, 'counter dialog open (seller)');

    // Fill and send the counter so the buyer-side accept can be probed.
    const cd = ep.getByRole('dialog');
    const counterAmount = cd.getByRole('textbox').first();
    await counterAmount.fill('45.00');
    const sendCounter = cd.getByRole('button', { name: /counter|send/i }).last();
    await sendCounter.click();
    await ep.waitForTimeout(5000);
    await dumpPage(ep, 'seller /offers after countering');
    await erin.close();

    // Carol accepts.
    await page.goto('/offers');
    await page.waitForLoadState('domcontentloaded');
    await dumpPage(page, 'buyer /offers with counter pending');
    const accept = page.getByRole('button', { name: 'Accept' }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      await page.waitForTimeout(1500);
      await dumpPage(page, 'buyer accept confirmation');
    } else {
      console.log('--- no Accept button on buyer side');
    }
  });

  test('offers page with a live offer', async ({ page, browser }) => {
    // Carol makes an offer on Erin's penny, then both sides' /offers are dumped.
    await page.goto(`/listings/${ERIN_ITEM}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Make an offer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    await dialog.getByLabel('Your offer').fill('40.00');
    await dialog.getByLabel(/Message/i).fill('[E2E] inspector offer');
    await dialog.getByRole('button', { name: 'Send offer' }).click();
    await page.waitForTimeout(6000);
    console.log('--- url after send offer:', new URL(page.url()).pathname);
    await dumpPage(page, 'carol /offers (buyer side)');

    const erin = await browser.newContext({ storageState: storageStatePath(ERIN) });
    const erinPage = await erin.newPage();
    await erinPage.goto('/offers');
    await dumpPage(erinPage, 'erin /offers (seller side)');
    await erin.close();
  });
});

test.describe('inspect as dave', () => {
  test.use({ storageState: storageStatePath(DAVE) });

  test('profile after save', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Display name').fill('Dave Ellis Edited');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(3000);
    console.log('--- immediately after save, dialog visible:', await dialog.isVisible().catch(() => 'n/a'));
    console.log('--- body contains "Edited":', (await page.content()).includes('Edited'));
    await dumpPage(page, 'profile immediately after save');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    console.log('--- after reload, body contains "Edited":', (await page.content()).includes('Edited'));
    await dumpPage(page, 'profile after reload');

    // restore
    await page.getByRole('button', { name: 'Edit' }).click();
    const restore = page.getByRole('dialog');
    await restore.getByLabel('Display name').fill('Dave Ellis');
    await restore.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(2000);
  });
});

test.describe('inspect cash sale room', () => {
  test('open a sale and dump the room for both parties', async ({ browser }) => { // Alice lists something disposable, Bob buys it, then both sides of the room
  // are dumped. A fresh listing because opening a contract reserves it.
  const alice = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const ap = await alice.newPage();
  const title = `[E2E] room probe ${Date.now()}`;
  await createListing(ap, { title, priceDollars: '120.00' });
  
  const bob = await browser.newContext({ storageState: storageStatePath(BOB) });
  const bp = await bob.newPage();
  const itemId = new URL(ap.url()).pathname.split('/').pop()!;
  
  await bp.goto(`/listings/${itemId}`);
  await bp.waitForLoadState('domcontentloaded');
  await bp.getByRole('button', { name: 'Buy now' }).click();
  
  const dlg = bp.getByRole('dialog');
  const addCard = dlg.getByRole('heading', { name: 'Add a payment method' });
  const checkout = dlg.getByRole('heading', { name: 'Start a purchase contract' });
  await expect(addCard.or(checkout)).toBeVisible({ timeout: 25_000 });
  if (await addCard.isVisible().catch(() => false)) {
    await dlg.getByRole('button', { name: /Save demo card/i }).click();
    await expect(checkout).toBeVisible({ timeout: 25_000 });
  }
  await dlg.getByRole('checkbox').check();
  await dlg.getByRole('button', { name: 'Reserve item and agree terms' }).click();
  await bp.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 40_000 });
  const saleUrl = new URL(bp.url()).pathname;
  console.log('--- sale url:', saleUrl);
  
  await dumpPage(bp, 'cash sale room — BUYER at AGREEMENT');
  
  await ap.goto(saleUrl);
  await dumpPage(ap, 'cash sale room — SELLER at AGREEMENT');
  
  await alice.close();
  await bob.close(); });
});

test.describe('inspect anonymous', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('landing', async ({ page }) => {
    await page.goto('/');
    await dumpPage(page, 'landing (anon)');
  });

  test('sign up', async ({ page }) => {
    await page.goto('/sign-up');
    await dumpPage(page, 'sign-up (anon)');
  });

  test('catalog', async ({ page }) => {
    await page.goto('/listings');
    await dumpPage(page, 'catalog (anon)');
  });
});
