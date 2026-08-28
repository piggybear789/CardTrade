// Back to white surfaces, keeping the muted lilac. The neutral ramp tints
// faintly toward 275 (the accent hue) rather than back to the old 240 blue,
// so greys belong to the palette instead of fighting it.

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
const toHex = (r) => '#' + r.map((c) => c.toString(16).padStart(2, '0')).join('');
const lum = (rgb) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const T = {
  background: [0, 0, 100],
  card: [0, 0, 100],
  sidebar: [275, 16, 97],
  muted: [275, 20, 96],
  secondary: [275, 20, 96],
  secondaryForeground: [275, 25, 28],
  foreground: [275, 10, 12],
  mutedForeground: [275, 8, 42],
  border: [275, 18, 90],
  input: [275, 20, 62],
  obsidian: [275, 16, 7],
  mist: [275, 20, 93],
  primary: [275, 38, 44],
  irisInk: [275, 34, 52],
  iris: [275, 34, 58],
  accent: [278, 46, 93],
  trust: [173, 80, 26],
  action: [32, 96, 52],
  destructive: [0, 80, 40],
};
const rgb = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, hslToRgb(...v)]));
const WHITE = [255, 255, 255];

console.log('=== TOKENS ===');
for (const [k, [h, s, l]] of Object.entries(T)) {
  console.log(`  ${k.padEnd(18)} hsl(${h} ${s}% ${l}%)  ${toHex(rgb[k])}`);
}

const checks = [
  ['ink on page', 'foreground', 'background', 4.5],
  ['ink on sidebar', 'foreground', 'sidebar', 4.5],
  ['muted on page', 'mutedForeground', 'background', 4.5],
  ['muted on sidebar', 'mutedForeground', 'sidebar', 4.5],
  ['muted on muted', 'mutedForeground', 'muted', 4.5],
  ['secondary text', 'secondaryForeground', 'secondary', 4.5],
  ['lilac text on page', 'irisInk', 'background', 4.5],
  ['trust on page', 'trust', 'background', 4.5],
  ['destructive on page', 'destructive', 'background', 4.5],
  ['FOCUS ring on page', 'iris', 'background', 3.0],
  ['FOCUS ring on header', 'iris', 'obsidian', 3.0],
  ['input edge on page', 'input', 'background', 3.0],
  ['mist on header', 'mist', 'obsidian', 4.5],
];

console.log('\n=== PAIRS ===');
let fails = 0;
for (const [label, a, b, min] of checks) {
  const r = cr(rgb[a], rgb[b]);
  if (r < min) fails += 1;
  console.log(`${label.padEnd(22)} ${r.toFixed(2).padStart(5)}:1  need ${min}  ${r >= min ? 'PASS' : 'FAIL'}`);
}

console.log('\n=== ON-FILL ===');
for (const [label, fill, min, useInk] of [
  ['white on primary', 'primary', 4.5, false],
  ['white on trust', 'trust', 4.5, false],
  ['white on destructive', 'destructive', 4.5, false],
  ['ink on action', 'action', 4.5, true],
  ['primary on accent', 'accent', 4.5, null],
]) {
  const fg = label === 'primary on accent' ? rgb.primary : useInk ? rgb.foreground : WHITE;
  const r = cr(fg, rgb[fill]);
  if (r < min) fails += 1;
  console.log(`${label.padEnd(22)} ${r.toFixed(2).padStart(5)}:1  need ${min}  ${r >= min ? 'PASS' : 'FAIL'}`);
}

console.log(`\nsidebar vs page  ${cr(rgb.sidebar, rgb.background).toFixed(3)}:1 (surface step, not a text pair)`);
console.log(`\n${fails === 0 ? 'ALL PAIRS PASS' : fails + ' FAILURES'}`);
