// Lists every `asChild` usage with the first child tag that follows it, so a Slot
// receiving something other than a single DOM-ish element is easy to spot.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['app', 'components'];
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.tsx')) files.push(full);
  }
}
for (const root of roots) walk(root);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/\basChild\b/.test(line)) return;
    // Find the first following line that opens an element or an expression.
    for (let i = index; i < Math.min(index + 12, lines.length); i += 1) {
      const after = lines[i].slice(i === index ? line.indexOf('asChild') : 0);
      const match = after.match(/<([A-Za-z][\w.]*)/);
      if (match && !/asChild/.test(match[0])) {
        console.log(`${file}:${index + 1} -> <${match[1]}>`);
        return;
      }
      if (/\{/.test(after) && i > index) {
        console.log(`${file}:${index + 1} -> EXPRESSION ${after.trim().slice(0, 60)}`);
        return;
      }
    }
    console.log(`${file}:${index + 1} -> (no child found)`);
  });
}
