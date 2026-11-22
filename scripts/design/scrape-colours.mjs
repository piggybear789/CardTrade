// Scrape the colour system a live site actually paints: surfaces weighted by area,
// text colours weighted by characters, filled-button colours, border colours, and
// any CSS custom properties that look like palette tokens. Text output only.
//
//   node scripts/design/scrape-colours.mjs
import { chromium } from 'playwright';

const SITES = [
  ['Whatnot', 'https://www.whatnot.com/'],
  ['Depop', 'https://www.depop.com/'],
  ['Vinted AU', 'https://www.vinted.com.au/'],
  ['Grailed', 'https://www.grailed.com/'],
  ['Courtyard', 'https://courtyard.io/'],
  ['Airbnb', 'https://www.airbnb.com.au/'],
  ['Etsy', 'https://www.etsy.com/au/'],
  ['Vercel', 'https://vercel.com/'],
  ['Stripe', 'https://stripe.com/au'],
  ['Attio', 'https://attio.com/'],
  ['Clerk', 'https://clerk.com/'],
  ['Framer', 'https://www.framer.com/'],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  locale: 'en-AU',
});

for (const [name, url] of SITES) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const opaque = (c) => c && !/rgba\(.*, 0\)$/.test(c) && c !== 'transparent';
      const surfaces = new Map();
      const texts = new Map();
      const borders = new Map();
      const buttons = new Map();
      const add = (m, k, w) => m.set(k, (m.get(k) ?? 0) + w);
      const vpArea = innerWidth * innerHeight;
      for (const el of document.querySelectorAll('body, body *')) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight * 2 || r.width === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.opacity === '0') continue;
        const area = Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight * 2);
        if (opaque(s.backgroundColor) && area > 2000) add(surfaces, s.backgroundColor, area / vpArea);
        if (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none' && opaque(s.borderTopColor) && r.width > 40)
          add(borders, s.borderTopColor, 1);
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
        if (own.length > 0) add(texts, s.color, own.length);
        const isButton = el.matches('button, a, [role=button]') && r.height >= 28 && r.height <= 60 && r.width >= 60;
        if (isButton && opaque(s.backgroundColor)) add(buttons, `${s.backgroundColor} on-text ${s.color} r${s.borderRadius}`, 1);
      }
      const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}  (${v.toFixed(2)})`);

      // Palette-looking custom properties on :root.
      const root = getComputedStyle(document.documentElement);
      const vars = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.selectorText === ':root' || rule.selectorText === 'html') {
            for (const prop of rule.style) {
              if (prop.startsWith('--') && /(bg|background|surface|primary|brand|accent|gray|grey|neutral|text|border|fg)/i.test(prop)) {
                vars.push(`${prop}: ${root.getPropertyValue(prop).trim().slice(0, 40)}`);
              }
            }
          }
        }
      }
      return {
        title: document.title.slice(0, 50),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        surfaces: top(surfaces, 6),
        text: top(texts, 5),
        borders: top(borders, 4),
        filledButtons: top(buttons, 5),
        vars: vars.slice(0, 24),
      };
    });
    console.log(`\n=== ${name}\n${JSON.stringify(data, null, 1)}`);
  } catch (error) {
    console.log(`\n=== ${name}: FAILED ${String(error).slice(0, 100)}`);
  }
  await page.close();
}
await browser.close();
