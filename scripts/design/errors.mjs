// Load routes at phone width and print page errors and console errors. Review tool.
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:3000';
const routes = process.argv.slice(2);
const browser = await chromium.launch();
for (const [w, h, mobile] of [[390, 844, true], [1280, 800, false]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (e) => console.log(`  [${w}] pageerror: ${String(e.message).slice(0, 300)}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`  [${w}] console: ${m.text().slice(0, 4000)}`));
  for (const r of routes) {
    console.log(`${w} ${r}`);
    await page.goto(base + r, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => console.log('  goto', String(e).slice(0, 120)));
    await page.waitForTimeout(1500);
    const broken = await page.evaluate(() => document.body.innerText.includes("This page didn't load"));
    if (broken) console.log('  ERROR SCREEN');
  }
  await page.close();
}
await browser.close();


