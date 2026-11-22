// Layout-shift audit. Records EVERY layout-shift entry (including ones within 500ms of
// input, which CLS itself ignores, because a dialog filling in after a click is exactly
// the shift that matters here) on each route, then opens every dialog trigger on the
// page and records the shifts while it loads.
//
// Only elements Radix marks as dialog triggers (`aria-haspopup="dialog"`) are clicked,
// and nothing inside a dialog is ever clicked, so the audit cannot take an action.
//
//   node scripts/design/cls.mjs [--member=<display_name>] [--no-dialogs] <route> ...
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const member = args.find((a) => a.startsWith('--member='))?.slice(9);
const dialogs = !args.includes('--no-dialogs');
const widthArg = args.find((a) => a.startsWith('--width='))?.slice(8);
const routes = args.filter((a) => !a.startsWith('--'));
const base = process.env.BASE ?? 'http://localhost:3000';
const MIN = 0.0005;
// Buttons that open a dialog without being a Radix trigger. Opening only: nothing inside
// a dialog is ever clicked.
const OPENERS = /^(buy now|make (an )?offer|offer|request|report|share|leave a reference|leave a review|start a deal|private deal|propose trade|add a card|filters|send feedback|change|claim this account|link another handle)\b/i;
const TRIGGERS = '[aria-haspopup="dialog"]:visible, button:visible';

const observer = () => {
  window.__shifts = [];
  const describe = (node) => {
    if (!node || node.nodeType !== 1) return node?.nodeName ?? '?';
    const el = node;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 5).join('.') : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const testid = el.getAttribute('data-slot') || el.getAttribute('aria-label') || el.id || '';
    return `${el.tagName.toLowerCase()}${testid ? `[${testid}]` : ''}${cls ? '.' + cls : ''} "${text}"`;
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({
        t: Math.round(e.startTime),
        value: e.value,
        input: e.hadRecentInput,
        sources: (e.sources || []).slice(0, 3).map((s) => ({
          node: describe(s.node),
          from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round),
          to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round),
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
};

function report(label, shifts) {
  const real = shifts.filter((s) => s.value >= MIN);
  const total = real.reduce((sum, s) => sum + s.value, 0);
  console.log(`${total >= MIN ? 'SHIFT' : 'ok   '} ${total.toFixed(4)}  ${label}`);
  for (const s of real) {
    for (const src of s.sources) {
      console.log(`        +${s.t}ms ${s.value.toFixed(4)}${s.input ? ' (after input)' : ''}  ${src.node}  ${src.from.join(',')} -> ${src.to.join(',')}`);
    }
  }
}

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
  // A stored viewport hint belongs to whichever size ran last; without it the layout
  // guesses from the request, as it does for a first visit.
  await context.clearCookies({ name: 'nd_vw' });
  await context.addInitScript(observer);
  const page = await context.newPage();
  for (const route of routes) {
    const response = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => e);
    if (response instanceof Error || !response) {
      console.log(`FAIL  ${label} ${route}  ${String(response).slice(0, 80)}`);
      continue;
    }
    await page.waitForTimeout(2500);
    report(`${label} ${route}`, await page.evaluate(() => window.__shifts));
    if (!dialogs) continue;

    const all = page.locator(TRIGGERS);
    const picks = [];
    for (let k = 0; k < (await all.count()) && picks.length < 10; k++) {
      const el = all.nth(k);
      const popup = await el.getAttribute('aria-haspopup').catch(() => null);
      const text = ((await el.getAttribute('aria-label').catch(() => null)) || (await el.innerText().catch(() => '')) || '').trim();
      if (popup === 'dialog' || OPENERS.test(text)) picks.push(k);
    }
    const count = picks.length;
    for (let i = 0; i < count; i++) {
      await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const trigger = page.locator(TRIGGERS).nth(picks[i]);
      const name = ((await trigger.getAttribute('aria-label').catch(() => null)) || (await trigger.innerText().catch(() => '')) || '?')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      await page.evaluate(() => {
        window.__shifts = [];
        // A dialog's LAYOUT height per frame (offsetHeight ignores the entrance
        // animation's transform). Any change after its first frame is content that
        // arrived late and moved everything in it.
        window.__dialogHeights = [];
        const t0 = performance.now();
        const sample = () => {
          const d = [...document.querySelectorAll('[role="dialog"]')].find((el) => el.offsetHeight > 0);
          if (d) {
            const h = d.offsetHeight + '/' + d.scrollHeight;
            if (window.__dialogHeights.at(-1)?.h !== h) window.__dialogHeights.push({ t: Math.round(performance.now() - t0), h });
          }
          if (performance.now() - t0 < 3500) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const before = new URL(page.url()).pathname;
      await trigger.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
      if (new URL(page.url()).pathname !== before) {
        console.log(`skip  ${label} ${route} [${name}] navigated`);
        continue;
      }
      const open = await page.locator('[role="dialog"]:visible').count();
      report(`${label} ${route} dialog "${name}"${open ? '' : ' (no dialog opened)'}`, await page.evaluate(() => window.__shifts));
      const heights = await page.evaluate(() => window.__dialogHeights);
      if (heights.length > 1) {
        console.log(`RESIZE dialog "${name}" ${label} ${route}: ${heights.map((x) => `${x.t}ms ${x.h}`).join(' -> ')}`);
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  if (member) await context.storageState({ path: `playwright/.auth/design-${member}.json` });
  await context.close();
}
await browser.close();
