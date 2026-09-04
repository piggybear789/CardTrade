const fs = require('fs');
const { execSync } = require('child_process');

const MAP = JSON.parse(fs.readFileSync('.tmp-icon-map.json', 'utf8'));

let tsc = '';
try {
  tsc = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  tsc = (e.stdout || '') + (e.stderr || '');
}

const hits = [];
for (const line of tsc.split(/\r?\n/)) {
  const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS2\d+: Cannot find name '(\w+)'/);
  if (!m) continue;
  const [, file, ln, col, name] = m;
  if (!MAP[name]) continue;
  hits.push({ file, ln: +ln, col: +col, name });
}

const byFile = new Map();
for (const h of hits) {
  if (!byFile.has(h.file)) byFile.set(h.file, []);
  byFile.get(h.file).push(h);
}

let count = 0;
for (const [file, list] of byFile) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  // Apply right-to-left per line so earlier column offsets stay valid.
  list.sort((a, b) => b.ln - a.ln || b.col - a.col);
  for (const h of list) {
    const i = h.ln - 1;
    const start = h.col - 1;
    if (lines[i].slice(start, start + h.name.length) !== h.name) {
      console.log(`SKIP mismatch ${file}:${h.ln}:${h.col} expected ${h.name}`);
      continue;
    }
    lines[i] = lines[i].slice(0, start) + MAP[h.name] + lines[i].slice(start + h.name.length);
    count++;
  }
  fs.writeFileSync(file, lines.join('\n'));
}
console.log(`renamed ${count} value references across ${byFile.size} files`);
