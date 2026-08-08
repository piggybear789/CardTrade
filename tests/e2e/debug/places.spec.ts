import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';

test.use({ storageState: storageStatePath(ALICE) });

test('B2: state at the moment the suggestion should appear', async ({ page }) => {
  const resps: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('places.googleapis')) {
      let body = '';
      try {
        body = (await r.text()).slice(0, 120);
      } catch {
        body = '<unreadable>';
      }
      resps.push(`${r.status()} ${r.url().slice(-42)} :: ${body}`);
    }
  });

  await page.goto('/listings/new');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('radio', { name: /^One item/ }).check();
  await page.getByLabel('Title').fill('[E2E] probe state');
  await page.getByLabel('Description').fill('probe');
  await page.locator('#category').click();
  await page.getByRole('option', { name: 'Trading Cards' }).click();
  await page.locator('#subcategory').click();
  await page.getByRole('option').first().click();
  await page.locator('#condition').click();
  await page.getByRole('option', { name: 'Near Mint' }).click();
  await expect(page.locator('#condition')).toBeFocused({ timeout: 10_000 });
  await page.getByLabel('Price').fill('50.00');

  const input = page.getByLabel(/Based near/).first();
  await input.click();
  await input.fill('Sydney');

  for (const ms of [500, 1500, 3000, 6000]) {
    await page.waitForTimeout(ms === 500 ? 500 : 1000);
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}#${el.id || '(no id)'}` : 'none';
    });
    console.log(
      `--- t~${ms}ms active=${active} ariaExpanded=${await input.getAttribute('aria-expanded')} ` +
        `listbox=${await page.getByRole('listbox').count()} options=${await page.getByRole('option').count()} ` +
        `value=${JSON.stringify(await input.inputValue())}`,
    );
  }

  console.log('--- responses:');
  for (const r of resps) console.log(`      ${r}`);
  expect(true).toBe(true);
});
