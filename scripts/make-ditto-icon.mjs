import sharp from 'sharp';

const size = 512;
const pad = Math.round(size * 0.08);
const dittoSize = size - pad * 2;

const ditto = await sharp('public/brand/ditto.png')
  .resize(dittoSize, dittoSize, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const rx = Math.round(size * 0.22);
const rounded = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${rx}" fill="#0c0b0a"/>
  </svg>`,
);

await sharp(rounded)
  .composite([{ input: ditto, top: pad, left: pad }])
  .png()
  .toFile('app/icon.png');

await sharp('app/icon.png').resize(128, 128).toFile('tmp-logo-preview.png');
console.log('Wrote app/icon.png');
