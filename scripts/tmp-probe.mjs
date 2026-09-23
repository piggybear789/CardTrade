// Trace the phone scroll and attribute long main-thread tasks.
import { writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const [baseUrl, out = 'scripts/tmp-trace.json'] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});
await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
await page.waitForTimeout(6000);

const events = [];
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
await cdp.send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-v8.cpu_profiler',
  transferMode: 'ReportEvents',
});
for (let index = 0; index < 30; index += 1) {
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(300);
}
await page.waitForTimeout(2000);
await cdp.send('Tracing.end');
await done;
writeFileSync(out, JSON.stringify(events));

// Main renderer thread = thread with most RunTask events in the page process.
const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X');
const byThread = new Map();
for (const t of tasks) byThread.set(`${t.pid}:${t.tid}`, (byThread.get(`${t.pid}:${t.tid}`) ?? 0) + t.dur);
const main = [...byThread.entries()].sort((a, b) => b[1] - a[1])[0][0];
const [pid, tid] = main.split(':').map(Number);
const onMain = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X');
const longTasks = onMain.filter((e) => e.name === 'RunTask' && e.dur > 50_000);
console.log('long tasks', longTasks.length, longTasks.map((t) => Math.round(t.dur / 1000)).join(','));

const interesting = new Set([
  'FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame', 'EventDispatch',
  'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'ParseHTML',
  'Decode Image', 'ImageDecodeTask', 'IntersectionObserverController::computeIntersections',
  'V8.GCScavenger', 'MajorGC', 'MinorGC', 'V8.GC_MC_BACKGROUND_MARKING', 'RunMicrotasks',
  'HitTest', 'ScrollLayer', 'UpdateLayer', 'ResourceReceivedData', 'ResourceFinish',
  'v8.run', 'v8.callFunction', 'XHRReadyStateChange', 'MessageLoop',
]);
for (const task of longTasks) {
  const inside = onMain.filter(
    (e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur && interesting.has(e.name),
  );
  const agg = {};
  for (const e of inside) agg[e.name] = (agg[e.name] ?? 0) + e.dur / 1000;
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v)}`);
  const fn = inside.find((e) => e.name === 'FunctionCall' || e.name === 'EventDispatch' || e.name === 'TimerFire');
  const detail = fn?.args?.data ? `${fn.args.data.type ?? ''} ${(fn.args.data.url ?? '').slice(-40)} ${fn.args.data.functionName ?? ''}` : '';
  console.log(`task ${Math.round(task.dur / 1000)}ms:`, top.join(' | '), '::', detail);
}
await browser.close();
