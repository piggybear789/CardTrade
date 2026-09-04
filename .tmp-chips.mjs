import { chromium } from 'playwright';

const b = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }))
  .catch(() => chromium.launch());
const p = await (
  await b.newContext({ viewport: { width: 980, height: 900 }, deviceScaleFactor: 2 })
).newPage();
p.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});
await p.goto('http://localhost:3000/roomcheck-temp/chips', {
  waitUntil: 'networkidle',
  timeout: 90000,
});
await p.waitForTimeout(900);

// Every chip-shaped element, so mismatched geometry shows up as numbers.
const chips = await p.evaluate(() =>
  [...document.querySelectorAll('span, div')]
    .filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        r.height > 14 &&
        r.height < 34 &&
        cs.borderTopWidth !== '0px' &&
        parseFloat(cs.borderTopLeftRadius) > 2 &&
        (el.textContent || '').trim().length > 0 &&
        (el.textContent || '').trim().length < 30 &&
        el.children.length === 0
      );
    })
    .map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim().slice(0, 22),
        h: Math.round(el.getBoundingClientRect().height),
        radius: cs.borderTopLeftRadius,
        size: cs.fontSize,
        weight: cs.fontWeight,
      };
    }),
);
for (const c of chips) {
  console.log(
    `${String(c.h).padStart(3)}px  r=${c.radius.padEnd(6)} ${c.size.padEnd(5)} w${c.weight}  ${c.text}`,
  );
}

await p.screenshot({ path: 'ux-review/chips.png', scale: 'css', fullPage: true });
await b.close();
