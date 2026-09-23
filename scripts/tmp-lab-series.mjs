// Runs tmp-lab-catalog several times and prints one compact line per run.
// Usage: node scripts/tmp-lab-series.mjs <baseUrl> <label> <profile> <runs> [coldFirst]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [baseUrl, label, profile, runsRaw = '3', coldFirst = ''] = process.argv.slice(2);
const runs = Number(runsRaw);
const results = [];
for (let index = 0; index < runs; index += 1) {
  const cold = coldFirst === 'cold' && index === 0 ? 'cold' : '';
  const out = execFileSync(
    process.execPath,
    ['scripts/tmp-lab-catalog.mjs', baseUrl, `${label}-${index}`, profile, cold],
    { encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  const r = JSON.parse(out);
  results.push(r);
  const worstTap = r.interactions.worst[0];
  console.log(
    [
      r.label.padEnd(22),
      cold ? 'cold' : 'warm',
      `lcp ${r.load.lcp}`,
      `fcp ${r.load.fcp}`,
      `cls ${r.load.cls}`,
      `loadTBT ${r.loadTasks.blockingMs}`,
      `tiles ${r.scroll.tiles}`,
      `scrollLT ${r.scrollTasks.count}/${r.scrollTasks.maxMs}ms`,
      `frames>50 ${r.scroll.framesOver50ms} worst ${r.scroll.worstFrameMs}`,
      `tap ${worstTap ? `${worstTap.name} ${worstTap.dur} (proc ${worstTap.processing})` : '-'}`,
      `afterTapLT ${r.interactTasks.count}/${r.interactTasks.maxMs}ms`,
      `img ${r.bytesAfterScroll.Image?.count ?? 0}/${r.bytesAfterScroll.Image?.kb ?? 0}KB`,
      `js ${r.loadBytes.Script?.kb ?? 0}KB`,
      `err ${r.errors.length}`,
    ].join(' | '),
  );
}
writeFileSync(`scripts/tmp-series-${label}.json`, JSON.stringify(results, null, 1));
