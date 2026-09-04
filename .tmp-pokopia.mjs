// Can the Pokopia-direction hues do UI work as published, and if not, how far
// do they have to move? Same three jobs as the current palette:
//   fill carrying white text  >= 4.5:1
//   colour used AS text       >= 4.5:1
//   border / ring / marker    >= 3.0:1

const SAMPLES = {
  'Pixel Splat Green': '#8BC34A',
  'Lettering Purple': '#9C27B0',
  'Lettering Sky Blue': '#2196F3',
  'Lettering Orange': '#FF9800',
  'Lettering Amber': '#FFC107',
  'Daytime Sky Blue': '#87CEEB',
  'Soft Cream': '#FFF8E7',
  'Poke Ball Red': '#EE1515',
  'Ditto Soft Purple': '#A383BA',
};

const CREAM = '#FFF8E7';
const WHITE = '#FFFFFF';

const hexToRgb = (h) => {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
};
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
const cr = (a, b) => {
  const la = lum(typeof a === 'string' ? hexToRgb(a) : a);
  const lb = lum(typeof b === 'string' ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

console.log('AS PUBLISHED, against a soft-cream page (#FFF8E7)\n');
console.log('name                  hex       H    S    L   | as text | white on it | as border');
for (const [name, hex] of Object.entries(SAMPLES)) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const asText = cr(hex, CREAM);
  const white = cr(WHITE, hex);
  console.log(
    `${name.padEnd(20)} ${hex}  ${h.toFixed(0).padStart(3)} ${s.toFixed(0).padStart(3)}% ${l
      .toFixed(0)
      .padStart(3)}% | ${asText.toFixed(2).padStart(5)} ${asText >= 4.5 ? 'ok ' : 'NO '} |` +
      ` ${white.toFixed(2).padStart(5)} ${white >= 4.5 ? 'ok ' : 'NO '} |` +
      ` ${asText >= 3 ? 'ok' : 'NO'}`,
  );
}

console.log('\n\nSAME HUES, DARKENED UNTIL THEY CLEAR 4.5:1 AS TEXT ON CREAM');
console.log('(this is what they would actually have to become to be usable)\n');
for (const [name, hex] of Object.entries(SAMPLES)) {
  const [h, s] = rgbToHsl(hexToRgb(hex));
  let found = null;
  for (let l = rgbToHsl(hexToRgb(hex))[2]; l >= 0; l -= 0.5) {
    const cand = toHex(hslToRgb(h, s, l));
    if (cr(cand, CREAM) >= 4.5) {
      found = { l, cand, ratio: cr(cand, CREAM) };
      break;
    }
  }
  if (!found) continue;
  const drop = rgbToHsl(hexToRgb(hex))[2] - found.l;
  console.log(
    `${name.padEnd(20)} ${hex} -> ${found.cand}  hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${found.l}%)` +
      `  ${found.ratio.toFixed(2)}:1  (${drop.toFixed(0)} points darker)`,
  );
}

console.log('\n\nSURFACES: soft cream vs what we ship now\n');
console.log(`Soft Cream #FFF8E7 -> hsl(${rgbToHsl(hexToRgb(CREAM)).map((v, i) => (i ? v.toFixed(0) + '%' : v.toFixed(0))).join(' ')})`);
console.log(`  ink #1a1b25 on it:        ${cr('#1a1b25', CREAM).toFixed(2)}:1`);
console.log(`  current muted #63637e:    ${cr('#63637e', CREAM).toFixed(2)}:1`);
console.log(`  current primary #6d44a7:  white on it ${cr(WHITE, '#6d44a7').toFixed(2)}:1`);

console.log('\n\nDITTO SOFT PURPLE vs our current violet family\n');
const dsp = '#A383BA';
console.log(`Ditto Soft Purple ${dsp}  hsl(${rgbToHsl(hexToRgb(dsp)).map((v, i) => (i ? v.toFixed(0) + '%' : v.toFixed(0))).join(' ')})`);
console.log(`  as text on cream:  ${cr(dsp, CREAM).toFixed(2)}:1  ${cr(dsp, CREAM) >= 4.5 ? 'ok' : 'NO - too light for text'}`);
console.log(`  as a border:       ${cr(dsp, CREAM).toFixed(2)}:1  ${cr(dsp, CREAM) >= 3 ? 'ok' : 'NO'}`);
console.log(`  current --iris  #846feb: ${cr('#846feb', CREAM).toFixed(2)}:1 as border`);
console.log(`  current --primary #6d44a7 hue is 265; Ditto Soft Purple hue is ${rgbToHsl(hexToRgb(dsp))[0].toFixed(0)}`);
