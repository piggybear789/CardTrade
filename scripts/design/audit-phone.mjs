// Phone-width visual audit of every route: a viewport shot (what the first screen
// shows) and a full-page shot, signed in as a saved design session, plus signed-out
// shots of the public pages. Reports page errors, redirects and horizontal overflow.
//   node scripts/design/audit-phone.mjs <display_name> [outDir] [comma-separated routes]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const [name, outArg, routesJson] = process.argv.slice(2);
const base = 'http://localhost:3000';
const out = outArg ?? `design/review/phone-${name}`;
mkdirSync(out, { recursive: true });

const PUBLIC = [
  '/', '/sign-in', '/sign-up', '/forgot-password', '/help', '/privacy', '/terms', '/safety',
  '/trusted-sellers', '/references', '/references/check', '/report-scam', '/deals',
];
const MEMBER = routesJson
  ? routesJson.split(',').filter(Boolean)
  : [
      '/', '/listings/mine', '/listings/new', '/saved', '/offers', '/sales', '/purchases', '/trades',
      '/trades/new', '/messages', '/notifications', '/profile', '/profile?tab=verification',
      '/profile?tab=payouts', '/profile/payouts', '/deals', '/trusted-sellers/apply', '/report-scam',
      '/onboarding', '/admin', '/admin/arbitration',
    ];

const phone = { ...devices['iPhone 13'], deviceScaleFactor: 2 };
const browser = await chromium.launch();

async function shoot(context, routes, prefix) {
  const page = await context.newPage();
  let errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  for (const route of routes) {
    errors = [];
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const slug = `${prefix}-${route.replace(/^\//, '').replace(/[/?=&]/g, '_').slice(0, 70) || 'home'}`;
    await page.screenshot({ path: `${out}/${slug}.jpg`, type: 'jpeg', quality: 72 });
    await page.screenshot({ path: `${out}/${slug}-full.jpg`, type: 'jpeg', quality: 60, fullPage: true });
    const landed = new URL(page.url()).pathname;
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).position !== 'fixed')
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
      return document.documentElement.scrollWidth > w ? wide : [];
    });
    const broken = await page.evaluate(() => document.body.innerText.includes("This page didn't load"));
    const notes = [
      landed !== route.split('?')[0] ? `-> ${landed}` : '',
      broken ? 'ERROR SCREEN' : '',
      overflow.length ? `OVERFLOW ${overflow.join(', ')}` : '',
      ...new Set(errors),
    ].filter(Boolean);
    console.log(`${slug}${notes.length ? '  ' + notes.join(' | ') : ''}`);
  }
  await page.close();
}

if (!routesJson) {
  const anon = await browser.newContext(phone);
  await shoot(anon, PUBLIC, 'anon');
  await anon.close();
}
const storageState = `playwright/.auth/design-${name}.json`;
const member = await browser.newContext({ ...phone, storageState });
await shoot(member, MEMBER, 'm');
await member.storageState({ path: storageState });
await member.close();
await browser.close();
