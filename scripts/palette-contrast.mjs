// scripts/palette-contrast.mjs
//
// Checks a candidate palette against every colour pairing the app actually renders,
// so a pastel retune cannot quietly drop a control under the WCAG floor. The token
// comments in app/globals.css record measured ratios; this is the tool that produces
// them, so those comments stay true after a change.
//
//   node scripts/palette-contrast.mjs            check the CANDIDATE below
//   node scripts/palette-contrast.mjs --current  check the values shipping today
//
// Floors: 4.5 for body text, 3.0 for large text and for the boundary of a control
// (WCAG 2.2 SC 1.4.3 and SC 1.4.11).

const CURRENT = {
  background: [0, 0, 100],
  card: [0, 0, 100],
  sidebar: [275, 16, 96],
  obsidian: [275, 16, 7],
  foreground: [275, 10, 12],
  primary: [275, 38, 44],
  primaryForeground: [0, 0, 100],
  iris: [275, 34, 58],
  irisInk: [275, 34, 51],
  secondary: [275, 20, 95],
  secondaryForeground: [275, 25, 28],
  muted: [275, 20, 95],
  mutedForeground: [275, 8, 42],
  accent: [278, 46, 92],
  accentForeground: [275, 38, 44],
  destructive: [0, 80, 40],
  destructiveForeground: [0, 0, 100],
  border: [275, 18, 85],
  input: [275, 20, 60],
  trust: [173, 80, 26],
  action: [40, 96, 68],
  actionForeground: [275, 16, 7],
  actionBorder: [38, 88, 42],
  mist: [275, 20, 93],
};

// PASTEL RETUNE.
// The strategy is deliberately NOT "pastel fills with ink labels": `--primary-foreground`
// is used as a stand-in for white on the obsidian header and on the near-black selected
// chips in GenrePills / CatalogControls, so inverting it would turn those dark-on-dark.
// Instead the neutrals carry the pastel — a tinted page, a warmer hairline, softer greys —
// and each accent is lightened as far as its own contrast floor allows.
const CANDIDATE = {
  // Paper, not white. This is what does most of the pastel work, and it gives cards a
  // surface to sit above for free.
  background: [280, 44, 98],
  card: [0, 0, 100],
  sidebar: [280, 34, 95.5],

  // Deep plum rather than near-black. Still unmistakably dark chrome, but it belongs to
  // the 275 family instead of reading as a separate black.
  obsidian: [276, 26, 16],
  mist: [280, 34, 93],

  // Ink lightened off near-black: pastel palettes look wrong under 12% ink.
  foreground: [276, 22, 17],

  // Softened from 38/44. Held at the lightest value that keeps white label text at 4.5.
  primary: [276, 34, 47],
  primaryForeground: [0, 0, 100],

  // NOT lightened into the pastel range, and this is the one place the retune has to
  // hold its nerve. `border-iris` at full opacity IS the focus indicator in this
  // codebase (see the --border comment in globals.css), so it owes 3:1 against both the
  // page and a card. A 70% lilac measured 2.46:1. `--accent` is the pastel violet
  // SURFACE; this is the marker.
  iris: [277, 42, 58],
  irisInk: [277, 40, 45],

  secondary: [281, 32, 95],
  secondaryForeground: [277, 26, 32],
  muted: [283, 34, 96],
  mutedForeground: [277, 12, 44],
  accent: [280, 48, 92],
  accentForeground: [277, 40, 40],

  // 0deg -> 352deg: `--action` sits at 40deg, so pure red was the closest hue in the
  // palette to the one carrying the opposite meaning. Lightened as far as white allows.
  destructive: [352, 62, 45],
  destructiveForeground: [0, 0, 100],

  border: [281, 26, 88],
  // A field's border is the only thing marking it as a control, so it owes the full 3:1
  // against the PAGE — and the page is now tinted, which is the worse case of the two.
  input: [277, 26, 59],

  // Teal lifted out of the near-black range, but only as far as `text-trust` on `--muted`
  // allows: that pairing is the binding constraint, not the button.
  trust: [172, 54, 30],

  // Already the one pastel in the old palette; hue nudged 2deg and lightened a touch now
  // that the page is tinted too.
  action: [42, 92, 78],
  actionForeground: [30, 60, 18],
  // The pastel fill is ~1.4:1 against the page and cannot be its own boundary, so this
  // carries the 3:1 on its behalf. Same reasoning as the token it replaces.
  actionBorder: [38, 82, 40],
};

/* ---------------------------------------------------------------- maths ---- */

function hslToRgb([h, s, l]) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(hsl) {
  const [r, g, b] = hslToRgb(hsl).map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hex = (hsl) =>
  '#' +
  hslToRgb(hsl)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('');

/* ------------------------------------------------------------- pairings ---- */
// Every pairing below is one the app actually renders. `floor` is 4.5 for text,
// 3 for large text and for a control's own boundary.
const PAIRS = (P) => [
  ['body ink on page', P.foreground, P.background, 4.5],
  ['body ink on card', P.foreground, P.card, 4.5],
  ['body ink on sidebar', P.foreground, P.sidebar, 4.5],
  ['body ink on muted', P.foreground, P.muted, 4.5],
  ['subtext on page', P.mutedForeground, P.background, 4.5],
  ['subtext on card', P.mutedForeground, P.card, 4.5],
  ['subtext on muted', P.mutedForeground, P.muted, 4.5],
  ['subtext on sidebar', P.mutedForeground, P.sidebar, 4.5],
  ['primary button label', P.primaryForeground, P.primary, 4.5],
  ['destructive button label', P.destructiveForeground, P.destructive, 4.5],
  ['trust button label (white)', [0, 0, 100], P.trust, 4.5],
  ['action button label', P.actionForeground, P.action, 4.5],
  ['iris-ink as text on page', P.irisInk, P.background, 4.5],
  ['iris-ink as text on card', P.irisInk, P.card, 4.5],
  ['iris-ink as text on muted', P.irisInk, P.muted, 4.5],
  ['iris-ink as text on sidebar', P.irisInk, P.sidebar, 4.5],
  ['accent-fg on accent', P.accentForeground, P.accent, 4.5],
  ['secondary-fg on secondary', P.secondaryForeground, P.secondary, 4.5],
  ['text-trust on page', P.trust, P.background, 4.5],
  ['text-trust on card', P.trust, P.card, 4.5],
  ['text-trust on muted', P.trust, P.muted, 4.5],
  ['text-destructive on page', P.destructive, P.background, 4.5],
  ['text-destructive on card', P.destructive, P.card, 4.5],
  ['text-destructive on muted', P.destructive, P.muted, 4.5],
  ['mist on obsidian header', P.mist, P.obsidian, 4.5],
  ['white on obsidian header', [0, 0, 100], P.obsidian, 4.5],
  // Non-text: control boundaries and focus indication, SC 1.4.11
  ['field border vs page', P.input, P.background, 3],
  ['field border vs card', P.input, P.card, 3],
  ['focus ring vs page', P.iris, P.background, 3],
  ['focus ring vs card', P.iris, P.card, 3],
  ['action edge vs page', P.actionBorder, P.background, 3],
  ['iris marker vs card', P.iris, P.card, 3],
];

/* --------------------------------------------------------------- report ---- */

/* ------------------------------------------------------- read the real thing ---- */
// Default mode parses app/globals.css, so this is a guard on what actually ships
// rather than a snapshot that drifts. `--candidate` checks the block above instead,
// which is how a retune gets designed before it is applied.
const TOKEN_MAP = {
  background: 'background',
  card: 'card',
  sidebar: 'sidebar',
  obsidian: 'obsidian',
  foreground: 'foreground',
  primary: 'primary',
  primaryForeground: 'primary-foreground',
  iris: 'iris',
  irisInk: 'iris-ink',
  secondary: 'secondary',
  secondaryForeground: 'secondary-foreground',
  muted: 'muted',
  mutedForeground: 'muted-foreground',
  accent: 'accent',
  accentForeground: 'accent-foreground',
  destructive: 'destructive',
  destructiveForeground: 'destructive-foreground',
  border: 'border',
  input: 'input',
  trust: 'trust',
  action: 'action',
  actionForeground: 'action-foreground',
  actionBorder: 'action-border',
  mist: 'mist',
};

async function readFromCss() {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = join(root, 'app/globals.css');
  const css = await readFile(path, 'utf8');

  // PARSE IT AS CSS BEFORE READING TOKENS OUT OF IT, and this check is here because
  // its absence shipped a broken stylesheet.
  //
  // The token comments in this file are long, and twice during the pastel retune a new
  // paragraph was appended AFTER the `*/` that closed the comment above it. That leaves
  // English prose sitting in a declaration block: `next dev` died on
  // `Unknown word RETUNE` and the whole app failed to render.
  //
  // Nothing else in the verification loop could see it. `tsc` does not read CSS,
  // `eslint` does not read CSS, and the regexes below happily found every `--token:`
  // they wanted on either side of the damage — so this script reported PASS on a
  // stylesheet that could not be compiled. A palette guard that validates colours in a
  // file that does not parse is checking the wrong thing first.
  const { default: postcss } = await import('postcss');
  try {
    postcss.parse(css, { from: path });
  } catch (error) {
    console.error(`\n  app/globals.css does not parse as CSS:\n  ${error.message}\n`);
    process.exit(2);
  }

  const out = {};
  const missing = [];
  for (const [key, token] of Object.entries(TOKEN_MAP)) {
    // `--action-foreground: var(--obsidian)` style aliases resolve below.
    const re = new RegExp(`--${token}:\\s*([^;]+);`);
    const m = css.match(re);
    if (!m) {
      missing.push(token);
      continue;
    }
    const raw = m[1].trim();
    const alias = raw.match(/var\(--([a-z-]+)\)/);
    if (alias) {
      out[key] = { alias: alias[1] };
      continue;
    }
    const nums = raw.match(/(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
    if (!nums) {
      missing.push(`${token} (unparsed: ${raw})`);
      continue;
    }
    out[key] = [Number(nums[1]), Number(nums[2]), Number(nums[3])];
  }

  // resolve one level of aliasing
  const byToken = Object.fromEntries(
    Object.entries(TOKEN_MAP).map(([k, t]) => [t, k]),
  );
  for (const [key, val] of Object.entries(out)) {
    if (val && val.alias) {
      const target = out[byToken[val.alias]];
      if (Array.isArray(target)) out[key] = target;
      else missing.push(`${key} -> var(--${val.alias}) unresolved`);
    }
  }

  if (missing.length) {
    console.error(`\n  could not read from globals.css: ${missing.join(', ')}\n`);
    process.exit(2);
  }
  return out;
}

const mode = process.argv.includes('--current')
  ? 'current'
  : process.argv.includes('--candidate')
    ? 'candidate'
    : 'shipped';

const P =
  mode === 'current' ? CURRENT : mode === 'candidate' ? CANDIDATE : await readFromCss();

console.log(
  `\n${
    mode === 'current'
      ? 'PRE-RETUNE VALUES (for comparison)'
      : mode === 'candidate'
        ? 'CANDIDATE (the block in this file)'
        : 'SHIPPED — parsed from app/globals.css'
  }\n`,
);

let fails = 0;
let tight = 0;
for (const [label, fg, bg, floor] of PAIRS(P)) {
  const r = ratio(fg, bg);
  const ok = r >= floor;
  if (!ok) fails++;
  else if (r < floor * 1.08) tight++;
  console.log(
    `  ${ok ? (r < floor * 1.08 ? '~' : ' ') : 'X'} ${label.padEnd(30)} ${r
      .toFixed(2)
      .padStart(6)} : 1   (needs ${floor})`,
  );
}

console.log('\n  swatches');
for (const [k, v] of Object.entries(P)) {
  if (!Array.isArray(v)) continue;
  console.log(`    ${k.padEnd(22)} ${v[0]} ${v[1]}% ${v[2]}%   ${hex(v)}`);
}

// Hue spacing — the round-2 finding was that action and destructive were the two
// closest hues while carrying the most opposed meanings.
const hues = { violet: P.primary[0], teal: P.trust[0], amber: P.action[0], rose: P.destructive[0] };
const sorted = Object.entries(hues).sort((a, b) => a[1] - b[1]);
console.log('\n  hue spacing');
for (let i = 0; i < sorted.length; i++) {
  const [n1, h1] = sorted[i];
  const [n2, h2] = sorted[(i + 1) % sorted.length];
  const gap = ((h2 - h1 + 360) % 360).toFixed(0);
  console.log(`    ${n1.padEnd(8)} ${String(h1).padStart(3)}deg  ->  ${n2.padEnd(8)} ${gap}deg apart`);
}

console.log(
  `\n  ${fails === 0 ? 'PASS' : `${fails} FAILURE(S)`}${tight ? ` · ${tight} within 8% of the floor` : ''}\n`,
);
process.exit(fails === 0 ? 0 : 1);
