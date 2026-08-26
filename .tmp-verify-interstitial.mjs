import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = '.tmp-shots';
mkdirSync(OUT, { recursive: true });

const SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`;

const BTN =
  'inline-flex touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-body font-semibold tracking-[0.01em] transition-colors duration-150 border-primary bg-primary text-primary-foreground shadow-sm';

/** Exact markup EmptyState emits, for each variant. */
function emptyState(variant) {
  const isPage = variant === 'page';
  const root = isPage
    ? 'flex w-full flex-col items-center justify-center px-group text-center max-md:px-0 py-5 md:py-14'
    : 'flex w-full flex-col items-center justify-center px-group text-center rounded-lg border border-dashed border-border bg-card max-md:items-start max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:text-left py-5 md:py-14';
  const iconCls = isPage
    ? 'items-center justify-center rounded-full border bg-muted text-muted-foreground md:flex md:size-12 flex size-12'
    : 'items-center justify-center rounded-full border bg-muted text-muted-foreground md:flex md:size-12 mb-1 hidden size-8 md:mb-0';
  const titleCls = isPage ? 'font-semibold text-lead mt-snug' : 'font-semibold text-body md:text-lead md:mt-snug';
  const actionCls = isPage
    ? 'mt-snug md:mt-group max-md:h-11 max-md:w-full max-md:max-w-xs h-10 px-4 py-2'
    : 'mt-snug md:mt-group w-auto h-9 rounded-md px-3';

  return `<div class="${root}">
    <div aria-hidden="true" class="${iconCls}">${SHIELD}</div>
    <h3 class="${titleCls}">Verify Your Identity First</h3>
    <p class="mt-tight max-w-sm text-pretty text-body text-muted-foreground">Verify your identity before you publish a listing. It takes about a minute and needs a photo ID.</p>
    <a class="${BTN} ${actionCls}">Verify identity</a>
  </div>`;
}

/** MarketplaceShell's mobile content column with `center`. */
function shell(inner) {
  return `<section class="flex w-full min-w-0 flex-1 flex-col items-center bg-background px-4 pt-3 pb-10 justify-center" style="min-height:100dvh">
    <div class="mx-auto flex min-h-0 w-full max-w-workspace flex-col my-auto">${inner}</div>
  </section>`;
}

const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }));
const context = await browser.newContext({ ...devices['iPhone 14'] });
const page = await context.newPage();

// Any app route loads the real compiled stylesheet.
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle', timeout: 60000 });

for (const variant of ['section', 'page']) {
  await page.evaluate(
    ({ html }) => {
      document.querySelectorAll('nextjs-portal').forEach((n) => n.remove());
      document.body.innerHTML = html;
    },
    { html: shell(emptyState(variant)) },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/interstitial-${variant}.png` });

  const probe = await page.evaluate(() => {
    const root = document.querySelector('section > div > div');
    const icon = root.querySelector('[aria-hidden="true"]');
    const btn = root.querySelector('a');
    const cs = getComputedStyle(root);
    const br = btn.getBoundingClientRect();
    return {
      textAlign: cs.textAlign,
      alignItems: cs.alignItems,
      iconDisplay: getComputedStyle(icon).display,
      titleSize: getComputedStyle(root.querySelector('h3')).fontSize,
      button: { w: Math.round(br.width), h: Math.round(br.height) },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(variant, JSON.stringify(probe));
}

await browser.close();
