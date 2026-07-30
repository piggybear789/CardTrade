import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// Trim transparent padding so the character fills the mark at small sizes.
const trimmed = await sharp('public/brand/ditto.png')
  .trim({ threshold: 5 })
  .png()
  .toBuffer();

const meta = await sharp(trimmed).metadata();
console.log('trimmed', meta.width, meta.height);

// Square canvas with a little breathing room (6% pad).
const side = Math.max(meta.width, meta.height);
const pad = Math.round(side * 0.06);
const canvas = side + pad * 2;
const left = Math.round((canvas - meta.width) / 2);
const top = Math.round((canvas - meta.height) / 2);

await sharp({
  create: {
    width: canvas,
    height: canvas,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: trimmed, left, top }])
  .png()
  .toFile('public/brand/ditto.png');

// High-res app icon
const size = 512;
const inset = Math.round(size * 0.06);
const dittoSize = size - inset * 2;
const ditto = await sharp('public/brand/ditto.png')
  .resize(dittoSize, dittoSize, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .png()
  .toBuffer();

const rx = Math.round(size * 0.22);
writeFileSync(
  'scripts/_icon-mask.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="#0c0b0a"/></svg>`,
);

await sharp('scripts/_icon-mask.svg')
  .png()
  .composite([{ input: ditto, top: inset, left: inset }])
  .toFile('app/icon.png');

await sharp('app/icon.png').toFile('public/icon.png');

const final = await sharp('public/brand/ditto.png').metadata();
console.log('final brand', final.width, final.height);
