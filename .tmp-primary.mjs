// Tone down --primary. It is a large solid fill, and a large area of saturated
// colour reads far louder than the same hue on a 1px ring or a line of text —
// so the fill can drop chroma without the accents following it down.
// White on it must stay >= 4.5:1 (the label is 14px/600, not "large text").

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
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const onWhite = (rgb) => (1.05) / (lum(rgb) + 0.05);

console.log('current                 hsl(248 60% 51%)  #4b36cc  white 7.78:1  <- too bright, too blue\n');
console.log('hue 248 is blue-violet; higher hue = truer purple. Lower sat = calmer.\n');

const candidates = [
  [258, 48, 48], [262, 44, 47], [265, 42, 46],
  [268, 38, 45], [262, 36, 44], [270, 34, 46],
  [258, 40, 44], [255, 38, 46], [265, 32, 44],
];

for (const [h, s, l] of candidates) {
  const rgb = hslToRgb(h, s, l);
  const ratio = onWhite(rgb);
  console.log(
    `hsl(${String(h).padStart(3)} ${String(s).padStart(2)}% ${String(l).padStart(2)}%)  ${toHex(rgb)}  ` +
      `white ${ratio.toFixed(2)}:1  ${ratio >= 4.5 ? 'ok' : 'FAIL'}  ` +
      `| +${h - 248}deg toward purple, ${s - 60} chroma`,
  );
}
