import sharp from 'sharp';

// App icon: photo Ditto on the obsidian rounded square. Do not also write
// public/icon.png — Next serves app/icon.png as /icon.png, and a public copy
// conflicts.

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

await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
          <rect width="${size}" height="${size}" rx="${rx}" fill="#0c0b0a"/>
        </svg>`,
      ),
      top: 0,
      left: 0,
    },
    { input: ditto, top: inset, left: inset },
  ])
  .png()
  .toFile('app/icon.png');

console.log('Wrote app/icon.png');
