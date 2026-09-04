// One-shot codemod: collapse the six copies of `TextLines` onto the shared one
// in `components/ui/skeleton.tsx`. Deleted after it runs.
import { readFileSync, writeFileSync } from 'node:fs';

const LOCAL_DEFS = [
  'app/(workspace)/admin/arbitration/[kind]/[ref]/loading.tsx',
  'components/auth/AuthFormSkeleton.tsx',
  'app/onboarding/loading.tsx',
  'app/(workspace)/admin/loading.tsx',
  'app/(workspace)/admin/arbitration/loading.tsx',
  'app/(marketing)/loading.tsx',
  'components/layout/WorkspaceSkeletons.tsx',
];

/** Byte range of the `TextLines` declaration plus any JSDoc directly above it. */
function declRange(src) {
  const match = /(?:export )?function TextLines\(/.exec(src);
  if (!match) return null;

  let start = match.index;
  const before = src.slice(0, start).trimEnd();
  if (before.endsWith('*/')) {
    const open = before.lastIndexOf('/**');
    if (open !== -1) start = open;
  }

  // Walk from the parameter list's `(` to the body's closing `}`.
  let i = src.indexOf('{', match.index + match[0].length - 1);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
}

function addImport(src, file) {
  if (/from '@\/components\/ui\/skeleton'/.test(src)) {
    // Fold into the existing import from the same module.
    return src.replace(
      /import \{([^}]*)\} from '@\/components\/ui\/skeleton';/,
      (_m, names) => {
        const list = names
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        if (!list.includes('TextLines')) list.push('TextLines');
        return `import { ${list.join(', ')} } from '@/components/ui/skeleton';`;
      },
    );
  }
  const anchor = /^import .*$/m.exec(src);
  if (!anchor) throw new Error(`no import anchor in ${file}`);
  const at = anchor.index + anchor[0].length;
  return `${src.slice(0, at)}\nimport { TextLines } from '@/components/ui/skeleton';${src.slice(at)}`;
}

for (const file of LOCAL_DEFS) {
  let src = readFileSync(file, 'utf8');
  const range = declRange(src);
  if (!range) {
    console.log(`skip (no local decl): ${file}`);
    continue;
  }
  src = src.slice(0, range[0]) + src.slice(range[1]);
  src = src.replace(/\n{3,}/g, '\n\n');
  src = addImport(src, file);
  writeFileSync(file, src);
  console.log(`deduped: ${file}`);
}

// Re-point the three files that imported it from WorkspaceSkeletons.
const REPOINT = [
  'components/listings/ItemFormSkeleton.tsx',
  'app/(workspace)/listings/[id]/loading.tsx',
  'app/(workspace)/loading.tsx',
];

for (const file of REPOINT) {
  let src = readFileSync(file, 'utf8');
  src = src.replace(
    /import \{([^}]*)\} from '@\/components\/layout\/WorkspaceSkeletons';/,
    (whole, names) => {
      const list = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (!list.includes('TextLines')) return whole;
      const rest = list.filter((n) => n !== 'TextLines');
      return rest.length
        ? `import { ${rest.join(', ')} } from '@/components/layout/WorkspaceSkeletons';`
        : '';
    },
  );
  src = addImport(src, file);
  src = src.replace(/\n{3,}/g, '\n\n');
  writeFileSync(file, src);
  console.log(`repointed: ${file}`);
}
