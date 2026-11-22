// Design probe: viewport screenshot (never full-page, so it stays under image limits)
// plus a text dump of layout columns and the computed styles of chrome elements.
//
//   node scripts/design/probe.mjs <url> <width>x<height> <outPrefix>
import { chromium } from 'playwright';

const [url, size = '1440x900', out = 'design/review/probe'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-${width}.jpg`, type: 'jpeg', quality: 70 });

const report = await page.evaluate(() => {
  const css = (el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      color: s.color,
      border: `${s.borderRightWidth} ${s.borderRightColor} | L ${s.borderLeftWidth} ${s.borderLeftColor}`,
      font: `${s.fontSize}/${s.lineHeight} w${s.fontWeight}`,
      shadow: s.boxShadow === 'none' ? undefined : s.boxShadow.slice(0, 80),
    };
  };
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className).trim().split(/\s+/).slice(0, 6).join('.')}`.slice(0, 140);

  // Which element owns each column of the viewport, at three heights.
  const columns = [];
  for (const y of [200, 450, 700]) {
    for (let x = 4; x < innerWidth; x += Math.round(innerWidth / 16)) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      columns.push({ x, y, el: label(el), rect: [r.left, r.top, r.width, r.height].map(Math.round), ...css(el) });
    }
  }

  // Chrome: header, aside, nav, main and their direct layout parents.
  const chrome = [...document.querySelectorAll('header, aside, nav, main, [data-slot], body > div > div')]
    .slice(0, 40)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el: label(el), rect: [r.left, r.top, r.width, r.height].map(Math.round), ...css(el) };
    })
    .filter((c) => c.rect[2] > 0 && c.rect[3] > 0);

  // Nav links in the left rail: colour and size.
  const links = [...document.querySelectorAll('aside a, nav a')].slice(0, 14).map((a) => {
    const r = a.getBoundingClientRect();
    return { text: a.textContent.trim().slice(0, 30), rect: [r.left, r.top, r.width, r.height].map(Math.round), ...css(a) };
  });

  return { scrollWidth: document.documentElement.scrollWidth, innerWidth, columns, chrome, links };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
