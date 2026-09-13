// design/compare/shoot-board.mjs
//
// Screenshots the MOCKUP frames named in `surfaces.mjs`, so each one can be put beside
// the real page it was drawn for.
//
//   node design/compare/shoot-board.mjs
//
// Resolves a `sheet#plate:kind:index` reference to a single `.win` or `.phone` element
// and shoots that element alone — not the whole sheet, which is a page of annotations
// the comparison does not want. A reference that resolves to nothing is REPORTED rather
// than skipped: a mapping that has gone stale is exactly what this is meant to catch.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { SURFACES } from './surfaces.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const boardDir = join(here, '..', 'mockups');
const outDir = join(here, '_shots', 'board');
mkdirSync(outDir, { recursive: true });

/** `sheet#plate:kind:index` -> parts. Kind and index are optional. */
function parseRef(ref) {
  const [sheetAndPlate, kind, index] = ref.split(':');
  const [sheet, plate] = sheetAndPlate.split('#');
  return { sheet, plate, kind: kind ?? null, index: index ? Number(index) : 0 };
}

// One reference per (surface, kind) pair. A surface with `board: 'sheet#plate'` and no
// kind wants BOTH the desktop and phone frames of that plate; an explicit kind wants
// only that one.
const wanted = [];
for (const surface of SURFACES) {
  if (!surface.board) continue;
  const ref = parseRef(surface.board);
  const kinds = ref.kind ? [ref.kind] : ['d', 'm'];
  for (const kind of kinds) {
    wanted.push({
      surface: surface.id,
      viewport: kind === 'd' ? 'desktop' : 'phone',
      sheet: ref.sheet,
      plate: ref.plate,
      kind,
      index: ref.kind ? ref.index : 0,
    });
  }
}

const bySheet = new Map();
for (const w of wanted) {
  if (!bySheet.has(w.sheet)) bySheet.set(w.sheet, []);
  bySheet.get(w.sheet).push(w);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const results = [];

for (const [sheet, entries] of bySheet) {
  await page.goto('file:///' + join(boardDir, sheet).replace(/\\/g, '/'));
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);

  for (const entry of entries) {
    const file = `${entry.surface}-${entry.viewport}.png`;
    const selector =
      `#${entry.plate} ${entry.kind === 'd' ? '.vp-d' : '.vp-m'} ` +
      `${entry.kind === 'd' ? '.win' : '.phone'}`;
    const target = page.locator(selector).nth(entry.index);

    const count = await target.count();
    if (count === 0) {
      console.log(`MISSING  ${entry.surface.padEnd(18)} ${entry.viewport.padEnd(7)} ${selector}`);
      results.push({ ...entry, file: null, ok: false });
      continue;
    }

    // The frame label, so the canvas can say which variant the board drew — several
    // plates carry two very different states under one id.
    const label = await page
      .locator(`#${entry.plate} ${entry.kind === 'd' ? '.vp-d' : '.vp-m'}`)
      .nth(entry.index)
      .locator('.frame-label')
      .first()
      .textContent()
      .then((t) => t?.trim() ?? null)
      .catch(() => null);

    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    await target.screenshot({ path: join(outDir, file) });
    const box = await target.boundingBox();

    results.push({
      ...entry,
      file,
      label,
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
      ok: true,
    });
    console.log(
      `ok       ${entry.surface.padEnd(18)} ${entry.viewport.padEnd(7)} ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}  ${label ?? ''}`,
    );
  }
}

await browser.close();
writeFileSync(join(here, '_shots', 'board.json'), JSON.stringify(results, null, 2));

const missing = results.filter((r) => !r.ok);
console.log(
  `\n${results.length} frame(s). ${missing.length ? `${missing.length} reference(s) resolved to nothing.` : 'Every reference resolved.'}`,
);
