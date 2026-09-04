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

const PAGE = hslToRgb(42, 100, 95);
const CARD = hslToRgb(0, 0, 100);

// The field border must clear 3:1 against the LIGHTER of the two surfaces it
// can sit on, which is the white card.
for (let l = 60; l >= 35; l -= 1) {
  const rgb = hslToRgb(38, 24, l);
  const onCard = cr(rgb, CARD);
  const onPage = cr(rgb, PAGE);
  if (onCard >= 3 && onPage >= 3) {
    console.log(
      `hsl(38 24% ${l}%) ${toHex(rgb)}  page ${onPage.toFixed(2)}:1  card ${onCard.toFixed(2)}:1`,
    );
    break;
  }
}
