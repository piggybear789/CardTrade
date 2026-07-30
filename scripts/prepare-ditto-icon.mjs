import sharp from 'sharp';
import { writeFileSync, unlinkSync } from 'node:fs';

const size = 512;
const inset = Math.round(size * 0.08);
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
const stroke = Math.round(size * 0.085);
const r = size / 2 - stroke * 1.05;
const pad = stroke * 1.35;

writeFileSync(
  'scripts/_icon-base.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${rx}" fill="#0c0b0a"/>
  </svg>`,
);

// Faint cancel — ~45% opacity to match LogoMark.
writeFileSync(
  'scripts/_icon-cancel.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e11d2e" stroke-width="${stroke}" stroke-opacity="0.45"/>
    <path d="M${pad} ${size - pad} L${size - pad} ${pad}" fill="none" stroke="#e11d2e" stroke-width="${stroke}" stroke-opacity="0.45" stroke-linecap="round"/>
  </svg>`,
);

const base = await sharp('scripts/_icon-base.svg').png().toBuffer();
const cancel = await sharp('scripts/_icon-cancel.svg').png().toBuffer();

await sharp(base)
  .composite([
    { input: ditto, top: inset, left: inset },
    { input: cancel, top: 0, left: 0 },
  ])
  .png()
  .toFile('app/icon.png');

await sharp('app/icon.png').toFile('public/icon.png');

unlinkSync('scripts/_icon-base.svg');
unlinkSync('scripts/_icon-cancel.svg');
console.log('Wrote app/icon.png + public/icon.png');
