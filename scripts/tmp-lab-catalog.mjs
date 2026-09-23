// Catalog lab run against a local production build fed by tmp-mock-supabase.
// Usage: node scripts/tmp-lab-catalog.mjs <baseUrl> <label> [phone|desktop] [cold]
import { rmSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const [baseUrl = 'http://localhost:3458', label = 'run', profile = 'phone', cold = ''] =
  process.argv.slice(2);
const cacheDir = process.env.IMAGE_CACHE_DIR;
if (cold === 'cold' && cacheDir) rmSync(cacheDir, { recursive: true, force: true });

const browser = await chromium.launch();
const context =
  profile === 'phone'
    ? await browser.newContext({ ...devices['Pixel 7'] })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
if (profile === 'phone') {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

const requests = new Map();
cdp.on('Network.responseReceived', (event) => {
  requests.set(event.requestId, { type: event.type, url: event.response.url, bytes: 0 });
});
cdp.on('Network.loadingFinished', (event) => {
  const entry = requests.get(event.requestId);
  if (entry) entry.bytes = event.encodedDataLength;
});
function bytesByType() {
  const out = {};
  for (const { type, bytes } of requests.values()) {
    out[type] = out[type] ?? { count: 0, kb: 0 };
    out[type].count += 1;
    out[type].kb += bytes / 1024;
  }
  for (const value of Object.values(out)) value.kb = Math.round(value.kb);
  return out;
}

const errors = [];
page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)));

await page.addInitScript(() => {
  const lab = { lcp: null, lcpEl: null, cls: 0, longtasks: [], events: [], frames: [] };
  window.__lab = lab;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      lab.lcp = Math.round(entry.startTime);
      lab.lcpEl = entry.element
        ? `${entry.element.tagName}${entry.url ? ` ${entry.url.slice(0, 90)}` : ''}`
        : entry.url?.slice(0, 90) ?? null;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) lab.cls += entry.value;
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      lab.longtasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
    }
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId) continue;
      lab.events.push({
        name: entry.name,
        start: Math.round(entry.startTime),
        dur: Math.round(entry.duration),
        inputDelay: Math.round(entry.processingStart - entry.startTime),
        processing: Math.round(entry.processingEnd - entry.processingStart),
        presentation: Math.round(entry.startTime + entry.duration - entry.processingEnd),
      });
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
});

function summarizeTasks(tasks, from = 0, to = Infinity) {
  const inRange = tasks.filter((task) => task.start >= from && task.start < to);
  return {
    count: inRange.length,
    blockingMs: inRange.reduce((sum, task) => sum + Math.max(0, task.dur - 50), 0),
    maxMs: inRange.reduce((max, task) => Math.max(max, task.dur), 0),
  };
}

const t0 = Date.now();
await page.goto(`${baseUrl}/`, { waitUntil: 'load', timeout: 120_000 });
const loadWallMs = Date.now() - t0;
await page.waitForTimeout(profile === 'phone' ? 6000 : 2500);

const load = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return {
    ttfb: Math.round(nav.responseStart),
    fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: window.__lab.lcp,
    lcpEl: window.__lab.lcpEl,
    cls: Math.round(window.__lab.cls * 1000) / 1000,
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    tiles: new Set([...document.querySelectorAll('a[href^="/listings/"]')].map((a) => a.getAttribute('href'))).size,
  };
});
const loadTasks = summarizeTasks(await page.evaluate(() => window.__lab.longtasks));
const loadBytes = bytesByType();

// Scroll through several batches with real wheel input while sampling frames.
const scrollStart = await page.evaluate(() => {
  const lab = window.__lab;
  lab.frames = [];
  let last = performance.now();
  lab.sampling = true;
  const tick = (now) => {
    lab.frames.push(now - last);
    last = now;
    if (lab.sampling) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return performance.now();
});
const steps = 30;
for (let index = 0; index < steps; index += 1) {
  if (profile === 'phone') {
    await page.mouse.wheel(0, 700);
  } else {
    await page.mouse.move(900, 500);
    await page.mouse.wheel(0, 900);
  }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(2000);
const scroll = await page.evaluate((from) => {
  const lab = window.__lab;
  lab.sampling = false;
  const frames = lab.frames.slice(1);
  const slow = frames.filter((delta) => delta > 50);
  return {
    from,
    frames: frames.length,
    framesOver50ms: slow.length,
    worstFrameMs: Math.round(frames.reduce((max, delta) => Math.max(max, delta), 0)),
    scrollY: Math.round(window.scrollY),
    tiles: new Set([...document.querySelectorAll('a[href^="/listings/"]')].map((a) => a.getAttribute('href'))).size,
    imgsComplete: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth > 0).length,
  };
}, scrollStart);
const scrollTasks = summarizeTasks(await page.evaluate(() => window.__lab.longtasks), scrollStart);
const scrollBytes = bytesByType();

// Interactions.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);
const interactStart = await page.evaluate(() => performance.now());
if (profile === 'phone') {
  const pills = page.locator('nav[aria-label="Categories"]:visible button[aria-pressed]');
  const count = await pills.count();
  if (count > 1) {
    await pills.nth(1).tap();
    await page.waitForTimeout(3500);
    await pills.nth(0).tap();
    await page.waitForTimeout(3500);
  }
} else {
  const filter = page.getByPlaceholder('Filter…');
  await filter.click();
  await page.keyboard.type('charizard', { delay: 120 });
  await page.waitForTimeout(1500);
  const pills = page.locator('nav[aria-label="Categories"]:visible button[aria-pressed]');
  if ((await pills.count()) > 1) {
    await pills.nth(1).click();
    await page.waitForTimeout(2500);
  }
}
const interactions = await page.evaluate((from) => {
  const byInteraction = new Map();
  for (const event of window.__lab.events) {
    if (event.start < from) continue;
    const key = `${event.name}@${event.start}`;
    const prev = byInteraction.get(key);
    if (!prev || prev.dur < event.dur) byInteraction.set(key, event);
  }
  const list = [...byInteraction.values()].sort((a, b) => b.dur - a.dur);
  return { count: list.length, worst: list.slice(0, 4) };
}, interactStart);
const interactTasks = summarizeTasks(await page.evaluate(() => window.__lab.longtasks), interactStart);

console.log(
  JSON.stringify(
    {
      label,
      profile,
      cold: cold === 'cold',
      loadWallMs,
      load,
      loadTasks,
      loadBytes,
      scroll,
      scrollTasks,
      bytesAfterScroll: scrollBytes,
      interactions,
      interactTasks,
      errors,
    },
    null,
    1,
  ),
);
await browser.close();
