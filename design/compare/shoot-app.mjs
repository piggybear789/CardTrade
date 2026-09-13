// design/compare/shoot-app.mjs
//
// Screenshots the REAL app, one PNG per surface per viewport, and records what the
// browser complained about while doing it.
//
//   node design/compare/shoot-app.mjs                 all surfaces
//   node design/compare/shoot-app.mjs sales offers     just those ids
//
// A PLAIN SCRIPT, NOT A PLAYWRIGHT TEST, deliberately. `playwright.config.ts` matches
// `specs/*.spec.ts`, so a spec placed here would either be skipped or — worse — start
// running inside `npm run test:e2e` and add fifty screenshots to a functional suite.
// This loads the storageState files the `setup` project already wrote and drives the
// browser itself.
//
// IT NEEDS A SERVER ON 3100 ALREADY RUNNING, because Playwright only manages
// `webServer` under `playwright test`. Start one with the e2e environment:
//
//   $env:PAYMENTS_PROVIDER='mock'; $env:ENABLE_PAYMENT_DEMO='true'
//   $env:NEXT_BUILD_DIR='.next-e2e'; npm run dev -- -p 3100
//
// WHY IT CAPTURES ERRORS AND NOT JUST PIXELS. A screenshot of a page that threw during
// hydration often looks fine — the server HTML is there and only the interactive parts
// are dead. The console is where that shows up, so every finding here pairs an image
// with whatever the page said while rendering it.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

import { SURFACES, VIEWPORTS } from './surfaces.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, '_shots', 'app');
mkdirSync(outDir, { recursive: true });

const BASE = process.env.COMPARE_BASE_URL ?? 'http://localhost:3100';

const only = process.argv.slice(2);
const wanted = only.length ? SURFACES.filter((s) => only.includes(s.id)) : SURFACES;

/** Noise every Next dev server emits that says nothing about our code. */
const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr|hot-update/i,
  /Node\.js 20 and below are deprecated/i,
  /favicon\.ico/i,
];
const isNoise = (text) => IGNORED.some((re) => re.test(text));

function statePath(as) {
  if (!as) return undefined;
  const p = join(root, 'playwright', '.auth', `${as}.json`);
  if (!existsSync(p)) {
    throw new Error(
      `No saved session for "${as}" at ${p}. Run: npx playwright test --project=setup`,
    );
  }
  return p;
}

const browser = await chromium.launch();
const results = [];

for (const vp of VIEWPORTS) {
  for (const surface of wanted) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      isMobile: vp.isMobile ?? false,
      hasTouch: vp.isMobile ?? false,
      storageState: statePath(surface.as),
      // The board is drawn in en-AU and money is formatted for it; matching here keeps
      // a currency string from differing for a reason that is not a design decision.
      locale: 'en-AU',
      timezoneId: 'Australia/Sydney',
    });

    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on('console', (m) => {
      if (m.type() === 'error' && !isNoise(m.text())) consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('requestfailed', (r) => {
      const url = r.url();
      if (!isNoise(url)) failedRequests.push(`${r.failure()?.errorText ?? 'failed'} ${url}`);
    });

    const file = `${surface.id}-${vp.key}.png`;
    const record = {
      id: surface.id,
      label: surface.label,
      viewport: vp.key,
      url: surface.url,
      as: surface.as ?? 'signed out',
      board: surface.board,
      file,
    };

    try {
      const response = await page.goto(BASE + surface.url, {
        waitUntil: 'domcontentloaded',
        // A cold dev route compiles on first request; 60s is the observed ceiling.
        timeout: 60_000,
      });
      record.status = response?.status() ?? null;

      // Settle: fonts, then a beat for Suspense boundaries and realtime subscriptions
      // to resolve into their real state rather than their skeleton.
      await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(1_200);

      // WHERE THE BROWSER ACTUALLY ENDED UP. A gate redirect is the single most likely
      // reason a surface does not look like its mockup, and it is invisible in a
      // screenshot of the page it landed on.
      record.landedOn = new URL(page.url()).pathname + new URL(page.url()).search;
      record.redirected = record.landedOn !== surface.url;

      record.title = await page.title();
      record.h1 = await page
        .locator('h1')
        .first()
        .textContent({ timeout: 2_000 })
        .then((t) => t?.trim().slice(0, 80) ?? null)
        .catch(() => null);

      // Horizontal overflow is the defect a screenshot hides, because the shot is
      // taken at the viewport width and the escaping content is simply cropped.
      record.overflowX = await page.evaluate(() => {
        const d = document.documentElement;
        return Math.max(0, d.scrollWidth - d.clientWidth);
      });
      record.fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);

      await page.screenshot({ path: join(outDir, file), fullPage: true });
      record.ok = true;
    } catch (error) {
      record.ok = false;
      record.error = String(error).split('\n')[0];
      // Shoot whatever is on screen anyway — a failed load still tells you something.
      await page.screenshot({ path: join(outDir, file) }).catch(() => {});
    }

    record.consoleErrors = consoleErrors;
    record.pageErrors = pageErrors;
    record.failedRequests = failedRequests.slice(0, 6);
    results.push(record);

    const flags = [
      record.ok ? null : 'LOAD FAILED',
      record.redirected ? `redirected -> ${record.landedOn}` : null,
      record.overflowX > 1 ? `overflow-x ${record.overflowX}px` : null,
      pageErrors.length ? `${pageErrors.length} page error(s)` : null,
      consoleErrors.length ? `${consoleErrors.length} console error(s)` : null,
    ].filter(Boolean);

    console.log(
      `${vp.key.padEnd(7)} ${surface.id.padEnd(18)} ${String(record.status ?? '-').padEnd(4)} ` +
        (flags.length ? flags.join(' · ') : 'clean'),
    );
    for (const e of pageErrors) console.log(`         ! ${e.slice(0, 160)}`);
    for (const e of consoleErrors.slice(0, 3)) console.log(`         · ${e.slice(0, 160)}`);

    await context.close();
  }
}

await browser.close();

// MERGED, NOT OVERWRITTEN. Re-shooting a handful of surfaces after a fix is the normal
// way this script gets used, and writing only those would drop every other surface from
// the manifest — so the comparison canvas would report two dozen pages as "not shot"
// when their PNGs are sitting right there on disk. Keyed by id + viewport so a re-shoot
// replaces its own record and leaves the rest alone.
const manifestPath = join(here, '_shots', 'app.json');
const merged = new Map();
if (existsSync(manifestPath)) {
  for (const record of JSON.parse(readFileSync(manifestPath, 'utf8'))) {
    merged.set(`${record.id}:${record.viewport}`, record);
  }
}
for (const record of results) merged.set(`${record.id}:${record.viewport}`, record);
writeFileSync(manifestPath, JSON.stringify([...merged.values()], null, 2));

const broken = results.filter((r) => !r.ok || r.pageErrors.length || r.redirected);
console.log(
  `\n${results.length} shot(s). ${broken.length ? `${broken.length} need attention.` : 'No load failures, no redirects, no page errors.'}`,
);
