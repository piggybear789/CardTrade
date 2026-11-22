// Layout shift during CLIENT-SIDE navigation and in-page data loads: the moments a
// loading skeleton is swapped for the page, or a list is refetched. Records every
// layout-shift entry after the click, including the ones CLS ignores as "after input".
//
//   node scripts/design/cls-nav.mjs [--member=<name>] [--width=desktop|phone]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const member = args.find((a) => a.startsWith('--member='))?.slice(9);
const widthArg = args.find((a) => a.startsWith('--width='))?.slice(8);
const base = process.env.BASE ?? 'http://localhost:3000';
const MIN = 0.0005;

// [start route, what to click (CSS or text=...), label]
const RAIL = ['/', '/saved', '/purchases', '/sales', '/trades', '/listings/new', '/listings/mine', '/offers', '/messages', '/notifications', '/profile'];
const STEPS = {
  desktop: [
    ...RAIL.flatMap((to, i) => {
      const from = RAIL[(i + RAIL.length - 1) % RAIL.length];
      return [[from, `aside a[href="${to}"]`, `rail ${from} -> ${to}`]];
    }),
    ['/', 'button[aria-pressed]:has-text("Pokémon")', 'catalog: pick a game'],
    ['/', 'button[aria-pressed]:has-text("All")', 'catalog: back to all'],
    ['/', 'a[href^="/listings/"]', 'catalog -> listing'],
    ['/references', 'a[href^="/references/"]', 'references -> a profile'],
    ['/references/serialcollect', 'text=Given', 'references: Given'],
    ['/references/serialcollect', 'button:has-text("Next")', 'references: next page'],
    ['/messages', 'a[href^="/messages/"]', 'inbox -> thread'],
    ['/profile', 'text=Verification', 'profile: Verification tab'],
    ['/profile', 'text=Payouts', 'profile: Payouts tab'],
    ['/purchases', 'text=Past', 'purchases: Past tab'],
    ['/listings/mine', 'text=Hidden', 'my listings: Hidden tab'],
    ['/notifications', 'button:has-text("Messages")', 'notifications: Messages filter'],
  ],
  phone: [
    ['/', 'nav a[href="/references"]', 'hub: browse -> references'],
    ['/references', 'nav a[href="/"]', 'hub: references -> browse'],
    ['/', 'nav a[href="/messages"]', 'hub: browse -> inbox'],
    ['/messages', 'nav a[href="/profile"]', 'hub: inbox -> account'],
    ['/profile', 'a[href="/purchases"]', 'account -> purchases'],
    ['/profile', 'a[href="/listings/mine"]', 'account -> my listings'],
    ['/', 'a[href^="/listings/"]', 'catalog -> listing'],
    ['/messages', 'a[href^="/messages/"]', 'inbox -> thread'],
    ['/references/serialcollect', 'text=Given', 'references: Given'],
  ],
};

function report(label, shifts) {
  const real = shifts.filter((s) => s.value >= MIN);
  const total = real.reduce((sum, s) => sum + s.value, 0);
  console.log(`${total >= MIN ? 'SHIFT' : 'ok   '} ${total.toFixed(4)}  ${label}`);
  for (const s of real) {
    for (const src of s.sources) console.log(`        +${s.t}ms ${s.value.toFixed(4)}  ${src.node}  ${src.from.join(',')} -> ${src.to.join(',')}`);
  }
}

const observer = () => {
  window.__shifts = [];
  window.__t0 = performance.now();
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return el?.nodeName ?? '?';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 5).join('.') : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${text}"`;
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({
        t: Math.round(e.startTime - window.__t0),
        value: e.value,
        sources: (e.sources || []).slice(0, 3).map((s) => ({
          node: describe(s.node),
          from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round),
          to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round),
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
};

const browser = await chromium.launch();
const sizes = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
].filter(([n]) => !widthArg || n === widthArg);

for (const [label, opts] of sizes) {
  const context = await browser.newContext({
    ...opts,
    ...(member ? { storageState: `playwright/.auth/design-${member}.json` } : {}),
  });
  await context.clearCookies({ name: 'nd_vw' });
  await context.addInitScript(observer);
  const page = await context.newPage();
  for (const [from, target, name] of STEPS[label]) {
    const response = await page.goto(base + from, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => e);
    if (response instanceof Error) {
      console.log(`FAIL  ${label} ${name}  ${String(response).slice(0, 80)}`);
      continue;
    }
    await page.waitForTimeout(1500);
    const link = page.locator(target).filter({ visible: true }).first();
    if (!(await link.count())) {
      console.log(`skip  ${label} ${name}  (nothing to click)`);
      continue;
    }
    await page.evaluate(() => {
      window.__shifts = [];
      window.__t0 = performance.now();
    });
    await link.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3500);
    report(`${label} ${name}`, await page.evaluate(() => window.__shifts));
  }
  if (member) await context.storageState({ path: `playwright/.auth/design-${member}.json` });
  await context.close();
}
await browser.close();
