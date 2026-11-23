// Small clips of the top of live reference sites, where their category rows live.
// Clips are 1280x420 at most, so they stay far under any image limit.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SITES = [
  ['airbnb', 'https://www.airbnb.com.au/'],
  ['vinted', 'https://www.vinted.com.au/catalog'],
  ['depop', 'https://www.depop.com/search/?q=pokemon'],
  ['ebay', 'https://www.ebay.com.au/b/Collectable-Card-Games/2536/bn_1852210'],
  ['tcgplayer', 'https://www.tcgplayer.com/'],
  ['stockx', 'https://stockx.com/trading-cards'],
  ['whatnot', 'https://www.whatnot.com/category/trading_card_games'],
  ['courtyard', 'https://courtyard.io/marketplace'],
];

mkdirSync('design/review/sites', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'en-AU',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
});
for (const [name, url] of SITES) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `design/review/sites/${name}.jpg`, type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 1280, height: 420 } });
    console.log('ok', name);
  } catch (error) {
    console.log('fail', name, String(error).slice(0, 80));
  }
  await page.close();
}
await browser.close();
