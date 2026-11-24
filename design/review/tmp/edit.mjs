import { chromium } from 'playwright';
const b = await chromium.launch();
const c = await b.newContext({ storageState: 'playwright/.auth/design-Alice Nguyen.json', viewport: { width: 390, height: 844 } });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack).slice(0, 900)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 900)); });
const r = await p.goto('http://localhost:3000/listings/aaaaaaa1-0000-0000-0000-000000000001/edit', { waitUntil: 'networkidle' });
console.log('status', r.status());
await b.close();
