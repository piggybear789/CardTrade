// Preview a palette on the live site by overriding the theme's CSS variables, then take
// viewport screenshots (never full-page). Review tool.
//
//   node scripts/design/preview-palette.mjs <name> [before]
import { chromium } from 'playwright';

const PALETTES = {
  bright: `
    --background: 0 0% 100%;
    --foreground: 222 47% 11%;
    --card: 0 0% 100%;
    --card-foreground: 222 47% 11%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 47% 11%;
    --primary: 250 88% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 250 100% 97.5%;
    --secondary-foreground: 250 55% 38%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215 19% 35%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222 47% 11%;
    --border: 214 32% 91%;
    --input: 215 14% 56%;
    --ring: 215 25% 27%;
    --sidebar: 210 40% 98%;
    --sidebar-border: 214 32% 91%;
    --iris: 250 90% 68%;
    --iris-ink: 250 70% 52%;
    --obsidian: 222 47% 7%;
  `,
};

const [name = 'bright', mode] = process.argv.slice(2);
const before = mode === 'before';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shoot(url, label) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  if (!before) await page.addStyleTag({ content: `:root { ${PALETTES[name]} }` });
  await page.waitForTimeout(600);
  const path = `design/review/palette-${before ? 'before' : name}-${label}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 72 });
  console.log(path);
}

await shoot('https://noditto.app/', 'home');
const listing = await page.evaluate(() => document.querySelector('a[href^="/listings/"]')?.getAttribute('href'));
if (listing) await shoot(`https://noditto.app${listing}`, 'listing');
await shoot('https://noditto.app/references/serialcollect', 'references');
await browser.close();
