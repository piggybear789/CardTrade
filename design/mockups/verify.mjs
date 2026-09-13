// design/mockups/verify.mjs
//
// Renders every sheet in headless Chromium and reports layout defects the eye would
// catch: frames whose content overflows the clip (so it is silently truncated),
// horizontal overflow inside a device frame, misaligned .rowgrid columns, and console
// errors. Writes a screenshot per sheet next to the board.
//
//   npx playwright test  -- no. This is a plain script:
//   node design/mockups/verify.mjs

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SHEETS = [
  'index.html',
  '01-discovery.html',
  '02-entry.html',
  '03-contracts.html',
  '04-comms-account.html',
  '05-admin-system.html',
];

// Budgets declared in board.css: .vp-d .clip is 820px of stage, .vp-m .clip is 800px.
// `fold` is how far content may run past a frame's own height before it counts as a
// defect rather than as a screen edge. The .clip fade marks anything under it.
const BUDGET = { fold: 90 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

let problems = 0;

for (const sheet of SHEETS) {
  const errors = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('file:///' + join(here, sheet).replace(/\\/g, '/'));
  await page.waitForLoadState('load');
  // Let the webfont settle so measurements are not taken against the fallback.
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);

  const report = await page.evaluate((budget) => {
    const out = { overflow: [], hoverflow: [], grids: [], frames: 0 };

    // Which plate is a node in? Used to make findings addressable.
    const plateOf = (el) => {
      const p = el.closest('.plate');
      return p?.id || p?.querySelector('h2')?.textContent?.trim().slice(0, 40) || '(top)';
    };

    for (const frame of document.querySelectorAll('.win, .phone')) {
      out.frames++;
      const kind = frame.classList.contains('win') ? 'win' : 'phone';
      // Measure the frame rather than assuming a budget: `.tall` frames are
      // legitimately larger, and hardcoding produced false positives for them.
      const limit = frame.clientHeight;
      const h = frame.scrollHeight;
      // Up to `budget.fold` past the edge is an honest fold and the .clip fade marks
      // it. Beyond that the mockup is losing content that was meant to be seen.
      if (h > limit + budget.fold) {
        out.overflow.push({
          plate: plateOf(frame),
          kind,
          height: h,
          limit,
          over: h - limit,
          label: frame.closest('.vp-d, .vp-m')?.querySelector('.frame-label')?.textContent?.trim().slice(0, 46),
        });
      }
      // Horizontal overflow inside a device frame means something is escaping the
      // viewport it is meant to be drawn in.
      if (frame.scrollWidth > frame.clientWidth + 2) {
        out.hoverflow.push({
          plate: plateOf(frame),
          kind,
          scrollWidth: frame.scrollWidth,
          clientWidth: frame.clientWidth,
        });
      }
    }

    // The outer frame is `overflow:hidden` with a fixed height, so content clipped by
    // an INNER pane (.content, .mbody, a tab panel) does not show up as frame
    // overflow. Those are the ones that silently cut a mockup off mid-sentence.
    out.clipped = [];
    for (const pane of document.querySelectorAll('.content, .mbody, .chatlog, .clip .card')) {
      const over = pane.scrollHeight - pane.clientHeight;
      if (over > 90 && getComputedStyle(pane).overflowY === 'hidden') {
        out.clipped.push({
          plate: plateOf(pane),
          cls: pane.className.split(/\s+/).slice(0, 3).join('.'),
          over,
          h: pane.clientHeight,
        });
      }
    }

    // .rowgrid: every row must place its Nth cell at the same x.
    for (const grid of document.querySelectorAll('.rowgrid')) {
      const rows = [...grid.querySelectorAll(':scope > .r')];
      if (rows.length < 2) continue;
      const xs = rows.map((r) =>
        [...r.children].map((c) => Math.round(c.getBoundingClientRect().left)),
      );
      const first = xs[0];
      const bad = xs.some((row) => row.length !== first.length || row.some((x, i) => x !== first[i]));
      out.grids.push({ plate: plateOf(grid), rows: rows.length, cols: first.length, aligned: !bad });
    }

    return out;
  }, BUDGET);

  const shot = sheet.replace('.html', '.png');
  await page.screenshot({ path: join(here, '_shots', shot), fullPage: true });

  const bad = report.overflow.length + report.hoverflow.length + errors.length +
    (report.clipped?.length ?? 0) + report.grids.filter((g) => !g.aligned).length;
  problems += bad;

  console.log(`\n${sheet}  —  ${report.frames} frames, ${bad ? bad + ' issue(s)' : 'clean'}`);
  for (const c of report.clipped ?? []) {
    console.log(`   CLIPPED   ${c.plate.padEnd(16)} ${c.cls.padEnd(22)} ${c.over}px past a ${c.h}px pane`);
  }
  for (const o of report.overflow) {
    console.log(`   OVERFLOW  ${o.plate.padEnd(16)} ${o.kind} content ${o.height}px vs ${o.limit}px budget (+${o.over})  [${o.label ?? ''}]`);
  }
  for (const o of report.hoverflow) {
    console.log(`   H-SCROLL  ${o.plate.padEnd(16)} ${o.kind} ${o.scrollWidth} > ${o.clientWidth}`);
  }
  for (const g of report.grids) {
    console.log(`   ${g.aligned ? 'grid OK  ' : 'MISALIGN '} ${g.plate.padEnd(16)} ${g.rows} rows x ${g.cols} cols`);
  }
  for (const e of errors) console.log(`   CONSOLE   ${e.slice(0, 140)}`);
}

// Spot-check that the palette decisions actually landed in the rendered output.
await page.goto('file:///' + join(here, '01-discovery.html').replace(/\\/g, '/'));
await page.waitForTimeout(150);
const palette = await page.evaluate(() => {
  const price = document.querySelector('.price');
  const dang = document.createElement('div');
  dang.style.color = 'hsl(var(--destructive))';
  document.body.appendChild(dang);
  const out = {
    priceColour: getComputedStyle(price).color,
    destructive: getComputedStyle(dang).color,
    foreground: getComputedStyle(document.body).getPropertyValue('--foreground').trim(),
  };
  dang.remove();
  return out;
});
console.log('\npalette check');
console.log(`   price colour  ${palette.priceColour}   (should be ink, not violet)`);
console.log(`   destructive   ${palette.destructive}   (should be the 352deg red)`);

await browser.close();
console.log(`\n${problems === 0 ? 'PASS — no layout defects found' : `${problems} issue(s) to fix`}`);
process.exit(0);
