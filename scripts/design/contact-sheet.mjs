// Tile screenshots into contact sheets so a set of phone shots can be reviewed a few
// at a time. Each sheet is a row of labelled images.
//   node scripts/design/contact-sheet.mjs <dir> <out-prefix> [perSheet=4] [filter regex]
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, outPrefix, perArg = '4', filter = ''] = process.argv.slice(2);
const per = Number(perArg);
const files = readdirSync(dir)
  .filter((f) => /\.(jpg|png)$/.test(f) && !/-full\./.test(f) && new RegExp(filter).test(f))
  .sort();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: per * 400, height: 900 } });
for (let i = 0; i < files.length; i += per) {
  const batch = files.slice(i, i + per);
  const cells = batch
    .map((f) => {
      const b64 = readFileSync(join(dir, f)).toString('base64');
      const mime = f.endsWith('png') ? 'png' : 'jpeg';
      return `<figure><figcaption>${f}</figcaption><img src="data:image/${mime};base64,${b64}"></figure>`;
    })
    .join('');
  await page.setContent(
    `<style>body{margin:0;display:flex;gap:10px;padding:10px;background:#888;font:12px sans-serif}
     figure{margin:0;width:390px}img{width:390px;display:block}figcaption{color:#fff;padding:2px 0}</style>${cells}`,
  );
  const out = `${outPrefix}-${String(i / per + 1).padStart(2, '0')}.jpg`;
  await page.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 70 });
  console.log(out, batch.join(' '));
}
await browser.close();
