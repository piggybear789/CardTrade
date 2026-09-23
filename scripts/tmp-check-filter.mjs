import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto('http://localhost:3456/', { waitUntil: 'domcontentloaded' });
const filter = page.locator('input[data-catalog-filter]:visible').first();
await filter.waitFor({ state: 'visible' });
await filter.click();
await filter.fill('');
await filter.pressSequentially('char', { delay: 50 });
const sequential = await filter.inputValue();
await filter.fill('charizard');
const value = await filter.inputValue();
const cards = await page.locator('a[href^="/listings/"]').count();
console.log(JSON.stringify({ sequential, value, cards, errors }, null, 2));
await browser.close();
