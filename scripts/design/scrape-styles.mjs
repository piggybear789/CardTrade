// Scrape the computed design styles of live reference sites. Text only: no screenshots
// are taken, so nothing here can trip an image-size limit.
//
//   node scripts/design/scrape-styles.mjs
import { chromium } from 'playwright';

const SITES = [
  ['TCGplayer search', 'https://www.tcgplayer.com/search/pokemon/product?q=charizard'],
  ['eBay AU search', 'https://www.ebay.com.au/sch/i.html?_nkw=pokemon+charizard+card'],
  ['Vercel docs', 'https://vercel.com/docs'],
  ['Linear docs', 'https://linear.app/docs'],
  ['Stripe docs', 'https://docs.stripe.com/payments'],
  ['Supabase dashboard docs', 'https://supabase.com/docs'],
  ['Vinted AU catalog', 'https://www.vinted.com.au/catalog?search_text=pokemon'],
  ['Shopify admin help', 'https://help.shopify.com/en/manual'],
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
    await page.waitForTimeout(3500);
    const data = await page.evaluate(() => {
      const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
      const bgOf = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (opaque(c)) return c;
        }
        return getComputedStyle(document.documentElement).backgroundColor;
      };
      const box = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          bg: bgOf(el),
          color: s.color,
          font: `${s.fontSize} w${s.fontWeight} ${s.letterSpacing !== 'normal' ? 'ls' + s.letterSpacing : ''}`.trim(),
          radius: s.borderRadius,
          border: s.borderTopWidth !== '0px' ? `${s.borderTopWidth} ${s.borderTopColor}` : undefined,
          shadow: s.boxShadow !== 'none' ? s.boxShadow.slice(0, 90) : undefined,
          pad: s.padding,
        };
      };

      // Sidebar: climb from a point in the left column to a tall, narrow element.
      let sidebar = null;
      for (const y of [300, 450, 600]) {
        for (let n = document.elementFromPoint(90, y); n && n !== document.body; n = n.parentElement) {
          const r = n.getBoundingClientRect();
          if (r.width >= 180 && r.width <= 420 && r.height >= 400 && r.left < 60) {
            sidebar = n;
            break;
          }
        }
        if (sidebar) break;
      }
      const content = document.elementFromPoint(innerWidth * 0.65, 500);
      const header = [...document.querySelectorAll('header, [role=banner]')].find(
        (h) => h.getBoundingClientRect().top < 5 && h.getBoundingClientRect().height > 30,
      );

      let side = null;
      if (sidebar) {
        const s = getComputedStyle(sidebar);
        const links = [...sidebar.querySelectorAll('a, button, [role=treeitem], label')]
          .filter((a) => a.getBoundingClientRect().height > 0)
          .slice(0, 40);
        const active =
          links.find((a) => a.getAttribute('aria-current') || a.getAttribute('aria-selected') === 'true' || a.dataset.active) ??
          links.find((a) => opaque(getComputedStyle(a).backgroundColor));
        const labels = [...sidebar.querySelectorAll('h2, h3, h4, h5, p, span, div')]
          .filter((e) => e.children.length === 0 && getComputedStyle(e).textTransform === 'uppercase')
          .slice(0, 1);
        side = {
          box: box(sidebar),
          borderRight: `${s.borderRightWidth} ${s.borderRightColor}`,
          item: links[3] ? { text: links[3].textContent.trim().slice(0, 24), ...box(links[3]) } : null,
          active: active ? { text: active.textContent.trim().slice(0, 24), ...box(active) } : null,
          sectionLabel: labels[0] ? { text: labels[0].textContent.trim().slice(0, 24), ...box(labels[0]) } : null,
        };
      }

      const buttons = [...document.querySelectorAll('button, a')]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 40 && r.height >= 24 && r.height <= 56 && r.top < 900 && b.textContent.trim().length > 1;
        })
        .filter((b) => opaque(getComputedStyle(b).backgroundColor) || getComputedStyle(b).borderTopWidth !== '0px')
        .slice(0, 6)
        .map((b) => ({ text: b.textContent.trim().slice(0, 20), ...box(b) }));

      // Product-card-like elements: something with an image and a price-looking string.
      const card = [...document.querySelectorAll('li, article, div')]
        .find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 160 && r.width < 340 && r.height > 220 && r.height < 520 && el.querySelector('img') && /[$€£]\s?\d/.test(el.textContent);
        });

      return {
        title: document.title.slice(0, 60),
        page: { bodyBg: getComputedStyle(document.body).backgroundColor, contentBg: content ? bgOf(content) : null, font: getComputedStyle(document.body).fontFamily.slice(0, 50) },
        header: header ? box(header) : null,
        side,
        buttons,
        card: card ? box(card) : null,
      };
    });
    console.log(`\n=== ${name} (${url})\n${JSON.stringify(data, null, 1)}`);
  } catch (error) {
    console.log(`\n=== ${name}: FAILED ${String(error).slice(0, 120)}`);
  }
  await page.close();
}
await browser.close();
