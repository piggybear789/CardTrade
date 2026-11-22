// Signed-in visual audit: viewport screenshots (never full-page) of every workspace
// route, at desktop and phone width, using a saved design session. Also reports page
// errors and the error screen.
//   node scripts/design/audit-member.mjs <display_name> '<extra routes JSON>'
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [name, ...extraRoutes] = process.argv.slice(2);
const base = 'http://localhost:3000';
const out = `design/review/member-${name}`;
mkdirSync(out, { recursive: true });

const routes = [
  '/', '/listings/new', '/listings/mine', '/saved', '/offers', '/sales', '/purchases', '/trades',
  '/trades/new', '/messages', '/notifications', '/profile', '/profile?tab=verification',
  '/profile?tab=payouts', '/profile/payouts', '/account', '/deals', '/trusted-sellers/apply',
  '/report-scam', '/admin',
  ...extraRoutes,
];

const browser = await chromium.launch();
const storageState = `playwright/.auth/design-${name}.json`;
for (const [label, opts] of [
  ['d', { viewport: { width: 1280, height: 800 } }],
  ['p', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const context = await browser.newContext({ ...opts, storageState });
  const page = await context.newPage();
  let errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/hydrated but some attributes|Download the React DevTools/.test(m.text())) {
      errors.push(`console: ${m.text().slice(0, 160)}`);
    }
  });
  for (const route of routes) {
    errors = [];
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const slug = route.replace(/^\//, '').replace(/[/?=]/g, '_').slice(0, 60) || 'home';
    await page.screenshot({ path: `${out}/${slug}-${label}.jpg`, type: 'jpeg', quality: 70 });
    const landed = new URL(page.url()).pathname;
    const broken = await page.evaluate(() => document.body.innerText.includes("This page didn't load"));
    const notes = [landed !== route.split('?')[0] ? `-> ${landed}` : '', broken ? 'ERROR SCREEN' : '', ...new Set(errors)].filter(Boolean);
    console.log(`${label} ${route}${notes.length ? '  ' + notes.join(' | ') : ''}`);
  }
  await context.storageState({ path: storageState });
  await context.close();
}
await browser.close();

