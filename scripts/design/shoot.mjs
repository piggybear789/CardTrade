// Viewport screenshots of a running build (never full-page). Review tool.
//   node scripts/design/shoot.mjs <baseUrl> <path> <out> [clipX,clipY,w,h]
import { chromium } from 'playwright';

const [base, route, out, clip] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(800);
const opts = { path: out, type: 'jpeg', quality: 80 };
if (clip) {
  const [x, y, width, height] = clip.split(',').map(Number);
  opts.clip = { x, y, width, height };
}
await page.screenshot(opts);
console.log(out);
await browser.close();
