// Throwaway: empty thread centres its hint, non-empty thread still bottom-anchors.
import { chromium } from 'playwright';

const base = process.env.EDGE_BASE ?? 'http://localhost:3000';
const cases = [
  ['empty', '1143d41f-3cec-4d0f-9e8d-db363485988c'],
  ['messages', 'e2e00005-0000-0000-0000-000000000002'],
];

const browser = await chromium.launch();
for (const [name, conv] of cases) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    storageState: 'playwright/.auth/alice.json',
  });
  const page = await context.newPage();
  await page.goto(`${base}/messages/${conv}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const m = await page.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    const logBox = log?.getBoundingClientRect();
    // The hint, or the last message row.
    const hint = [...document.querySelectorAll('[role="log"] p')].find((p) =>
      /No messages yet/.test(p.textContent ?? ''),
    );
    const rows = [...document.querySelectorAll('[role="log"] li')];
    const target = hint ?? rows[rows.length - 1] ?? null;
    const t = target?.getBoundingClientRect();
    if (!logBox || !t) return null;
    return {
      kind: hint ? 'hint' : 'last message',
      logTop: Math.round(logBox.top),
      logBottom: Math.round(logBox.bottom),
      targetCentre: Math.round(t.top + t.height / 2),
      logCentre: Math.round(logBox.top + logBox.height / 2),
      distanceToBottom: Math.round(logBox.bottom - t.bottom),
    };
  });

  if (!m) {
    console.log(`${name}: nothing measured`);
  } else {
    const offCentre = m.targetCentre - m.logCentre;
    console.log(
      `${name.padEnd(9)} ${m.kind.padEnd(13)} log ${m.logTop}-${m.logBottom}  ` +
        `off-centre ${offCentre}px  gapToBottom ${m.distanceToBottom}px`,
    );
  }
  await page.screenshot({ path: `design/compare/_empty-${name}.png` });
  await context.close();
}
await browser.close();
