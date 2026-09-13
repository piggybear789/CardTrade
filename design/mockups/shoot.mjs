// Screenshot one plate (or one frame) so it can be eyeballed.
//   node design/mockups/shoot.mjs 01-discovery.html catalog
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [sheet, sel] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto('file:///' + join(here, sheet).replace(/\\/g, '/'));
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(200);

const target = page.locator(sel.startsWith('.') ? sel : `#${sel}`).first();
const out = join(here, '_shots', `plate-${sel.replace(/[^a-z0-9]/gi, '')}.png`);
await target.screenshot({ path: out });
const box = await target.boundingBox();
console.log(`${out}  ${Math.round(box.width)} x ${Math.round(box.height)}`);
await browser.close();
