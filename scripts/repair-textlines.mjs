// Repairs the orphaned tail my earlier codemod left: it matched braces from the
// destructured parameter object instead of the function body, so the signature
// and JSDoc went but `: { ... }) { ...body... }` stayed.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'app/(workspace)/admin/arbitration/[kind]/[ref]/loading.tsx',
  'components/auth/AuthFormSkeleton.tsx',
  'app/onboarding/loading.tsx',
  'app/(workspace)/admin/loading.tsx',
  'app/(workspace)/admin/arbitration/loading.tsx',
  'app/(marketing)/loading.tsx',
  'components/layout/WorkspaceSkeletons.tsx',
];

// `[\s\S]*?\n\}` is non-greedy and every brace inside the body is indented, so
// it stops at the function's own closing brace in column 0.
const ORPHAN =
  /\n: \{\r?\n\s*className\?: string;\r?\n\s*widths: readonly string\[\];\r?\n\}\) \{[\s\S]*?\r?\n\}\r?\n/;

for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  if (!ORPHAN.test(src)) {
    console.log(`NO ORPHAN FOUND (inspect by hand): ${file}`);
    continue;
  }
  writeFileSync(file, src.replace(ORPHAN, '\n').replace(/\n{3,}/g, '\n\n'));
  console.log(`repaired: ${file}`);
}
