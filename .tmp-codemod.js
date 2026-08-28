const fs = require('fs');
const path = require('path');

const MAP = JSON.parse(fs.readFileSync('.tmp-icon-map.json', 'utf8'));
const APPLY = process.argv.includes('--apply');

const SKIP_DIRS = new Set(['node_modules', '.next', '.next-build', '.git', '.agents', '.kiro', '.impeccable']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]lucide-react['"];?[ \t]*\r?\n?/g;

// Blank out comments and string/JSX-text-ish literals so prose mentions of an
// icon name are not mistaken for real code references.
function stripNonCode(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/>[^<>{}]+</g, '><');
}

const report = { converted: [], manual: [], unmapped: new Set() };

for (const file of walk('.')) {
  let src = fs.readFileSync(file, 'utf8');
  if (!/from\s*['"]lucide-react['"]/.test(src)) continue;

  // local identifier -> hugeicons icon-data export name
  const locals = new Map();
  let usesIconType = false;

  const withoutImports = src.replace(IMPORT_RE, (_full, inner) => {
    for (let spec of inner.split(',')) {
      spec = spec.trim();
      if (!spec) continue;
      spec = spec.replace(/^type\s+/, '');
      const [imported, local = imported] = spec.split(/\s+as\s+/).map((s) => s.trim());
      if (imported === 'LucideIcon' || imported === 'LucideProps') {
        usesIconType = true;
        continue;
      }
      const target = MAP[imported];
      if (!target) {
        report.unmapped.add(imported);
        continue;
      }
      locals.set(local, target);
    }
    return '';
  });

  let out = withoutImports;
  const needed = new Set();
  const leftover = [];

  for (const [local, target] of locals) {
    const tag = new RegExp(`<${local}(?![A-Za-z0-9_$])`, 'g');
    const close = new RegExp(`</${local}(?![A-Za-z0-9_$])`, 'g');
    if (tag.test(out)) needed.add(target);
    out = out.replace(tag, `<HugeiconsIcon icon={${target}}`).replace(close, '</HugeiconsIcon');

    // any surviving bare reference means a non-JSX usage we must fix by hand
    const bare = new RegExp(`(?<![A-Za-z0-9_$.'"\`])${local}(?![A-Za-z0-9_$])`, 'g');
    if (bare.test(stripNonCode(out))) {
      leftover.push(local);
      needed.add(target);
    }
  }

  if (usesIconType) {
    out = out.replace(/\bLucideIcon\b/g, 'IconSvgElement');
  }

  // Build replacement imports, inserted where the first lucide import used to be.
  const lines = [];
  if (/<HugeiconsIcon/.test(out)) lines.push(`import { HugeiconsIcon } from '@hugeicons/react';`);
  if (usesIconType) lines.push(`import type { IconSvgElement } from '@hugeicons/react';`);
  if (needed.size) {
    const names = [...needed].sort().join(', ');
    lines.push(`import { ${names} } from '@hugeicons/core-free-icons';`);
  }

  if (lines.length) {
    const anchor = src.match(IMPORT_RE);
    const firstImport = anchor ? src.indexOf(anchor[0]) : -1;
    // re-run: place the new imports at the position of the first removed import
    const before = src.slice(0, firstImport);
    const beforeLen = before.replace(IMPORT_RE, '').length;
    out = out.slice(0, beforeLen) + lines.join('\n') + '\n' + out.slice(beforeLen);
  }

  if (leftover.length) report.manual.push(`${file}: ${leftover.join(', ')}`);
  if (usesIconType) report.manual.push(`${file}: LucideIcon type`);
  report.converted.push(file);

  if (APPLY) fs.writeFileSync(file, out);
}

console.log(`files touched: ${report.converted.length}`);
if (report.unmapped.size) console.log(`UNMAPPED: ${[...report.unmapped].join(', ')}`);
console.log(`\nNEEDS MANUAL REVIEW (${report.manual.length}):`);
for (const m of report.manual) console.log('  ' + m);
