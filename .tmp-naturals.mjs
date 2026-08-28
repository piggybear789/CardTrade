// Re-tint the neutral ramp warm to sit on soft cream, and soften the accents
// toward the muted lilac. Verify every pair that carries text or state.

const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const base =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return base.map((v) => Math.round((v + m) * 255));
};
const toHex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const lum = (rgb) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** Proposed palette. Warm neutrals on cream; lilac accents at three depths. */
const T = {
  background: [42, 100, 95],   // #FFF8E7 soft cream, verbatim
  card: [0, 0, 100],           // white — a card lifts off the warm page
  sidebar: [42, 45, 93],       // recedes below the page
  muted: [42, 45, 92],
  foreground: [30, 12, 11],    // warm near-black, was cool 235deg
  mutedForeground: [35, 10, 40],
  border: [40, 30, 86],
  input: [38, 24, 60],
  obsidian: [30, 14, 6],       // dark header, warmed off 248deg
  mist: [40, 34, 93],
  // Lilac at three depths. Hue 275 is Ditto Soft Purple's own.
  primary: [275, 38, 44],      // fill carrying white
  irisInk: [275, 34, 52],      // lilac AS text
  iris: [275, 34, 58],         // rings, borders, markers
  accent: [278, 46, 93],       // selected-state wash
  // Semantics, unchanged by this pass — re-verified against the new page.
  trust: [173, 80, 26],
  action: [32, 96, 52],
  destructive: [0, 80, 40],
};
const rgb = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [k, hslToRgb(...v)]),
);
const WHITE = [255, 255, 255];

console.log('=== PROPOSED TOKENS ===');
for (const [k, [h, s, l]] of Object.entries(T)) {
  console.log(`  ${k.padEnd(16)} hsl(${h} ${s}% ${l}%)  ${toHex(rgb[k])}`);
}

const checks = [
  ['ink on page', 'foreground', 'background', 4.5],
  ['ink on card', 'foreground', 'card', 4.5],
  ['ink on sidebar', 'foreground', 'sidebar', 4.5],
  ['muted on page', 'mutedForeground', 'background', 4.5],
  ['muted on card', 'mutedForeground', 'card', 4.5],
  ['muted on muted', 'mutedForeground', 'muted', 4.5],
  ['lilac text on page', 'irisInk', 'background', 4.5],
  ['lilac text on card', 'irisInk', 'card', 4.5],
  ['trust on page', 'trust', 'background', 4.5],
  ['trust on card', 'trust', 'card', 4.5],
  ['destructive on page', 'destructive', 'background', 4.5],
  ['FOCUS ring on page', 'iris', 'background', 3.0],
  ['FOCUS ring on card', 'iris', 'card', 3.0],
  ['FOCUS ring on header', 'iris', 'obsidian', 3.0],
  ['input edge on page', 'input', 'background', 3.0],
  ['input edge on card', 'input', 'card', 3.0],
];

console.log('\n=== PAIRS ===');
let fails = 0;
for (const [label, a, b, min] of checks) {
  const r = cr(rgb[a], rgb[b]);
  if (r < min) fails += 1;
  console.log(
    `${label.padEnd(22)} ${r.toFixed(2).padStart(5)}:1  need ${min}  ${r >= min ? 'PASS' : 'FAIL'}`,
  );
}

console.log('\n=== ON-FILL PAIRS ===');
for (const [label, fill, min] of [
  ['white on primary', 'primary', 4.5],
  ['white on trust', 'trust', 4.5],
  ['white on destructive', 'destructive', 4.5],
  ['ink on action', 'action', 4.5],
]) {
  const fg = label.startsWith('ink') ? rgb.foreground : WHITE;
  const r = cr(fg, rgb[fill]);
  if (r < min) fails += 1;
  console.log(
    `${label.padEnd(22)} ${r.toFixed(2).padStart(5)}:1  need ${min}  ${r >= min ? 'PASS' : 'FAIL'}`,
  );
}

console.log('\n=== SELECTED STATE ===');
const accentText = cr(rgb.primary, rgb.accent);
console.log(`primary text on accent  ${accentText.toFixed(2)}:1  ${accentText >= 4.5 ? 'PASS' : 'FAIL'}`);
console.log(`accent vs page          ${cr(rgb.accent, rgb.background).toFixed(2)}:1  (tint only; the text carries the state)`);

console.log('\n=== SURFACE ORDER (must be card > page > sidebar) ===');
for (const k of ['card', 'background', 'sidebar']) {
  console.log(`  ${k.padEnd(12)} L* ${(lum(rgb[k]) * 100).toFixed(1)}`);
}

console.log(`\n${fails === 0 ? 'ALL PAIRS PASS' : fails + ' FAILURES'}`);
