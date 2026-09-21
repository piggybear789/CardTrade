// scripts/prepare-brand-mark.mjs
//
// Turn the NoDitto logo artwork — the red "no" sign over Ditto, drawn on solid black —
// into the two assets the app actually serves:
//
//   public/brand/noditto-mark.png   the header mark: the sign alone, on transparency,
//                                   trimmed and squared, so it sits on the obsidian
//                                   desktop header and the pale phone chrome alike
//   app/icon.png                    the app icon / favicon / PWA icon: the same
//                                   transparent mark, with no backing plate. Earlier
//                                   icons sat on an obsidian rounded square; a browser
//                                   tab or a home screen supplies its own surface, and a
//                                   dark plate behind the sign was just a dark square.
//
// Usage: node scripts/prepare-brand-mark.mjs <path-to-source-image>
//
// WHY THE BLACK IS KEYED OUT RATHER THAN KEPT. The artwork's black is a canvas, not part
// of the sign, and a black square behind a 32px mark reads as a hole in a light header.
// The key is spatial, not a plain luminance cut: the black outside AND inside the ring is
// pure #000, so "near black" alone finds the background — but a luminance key would also
// eat Ditto's eyes and mouth (dark purple, max channel ~80). Only pixels that TOUCH the
// background are feathered; everything else is opaque, so the face survives intact.
//
// Do not also write public/icon.png — Next serves app/icon.png as /icon.png, and a
// public copy conflicts with it.

import sharp from 'sharp';

const [, , sourcePath] = process.argv;
if (!sourcePath) {
  console.error('usage: node scripts/prepare-brand-mark.mjs <source-image>');
  process.exit(1);
}

const MARK_OUT = 'public/brand/noditto-mark.png';
const ICON_OUT = 'app/icon.png';

/** Pixels whose brightest channel is at or below this are the black canvas. */
const BACKGROUND_MAX = 24;
/** Edge pixels reach full opacity once their brightest channel passes this. */
const EDGE_FULL = 200;
/** How far (in pixels) from the canvas a pixel counts as an anti-aliased edge. */
const EDGE_RADIUS = 2;

// ---------------------------------------------------------------------------
// 1. Key the black canvas to transparency, feathering only the edges that meet it.
// ---------------------------------------------------------------------------

const { data, info } = await sharp(sourcePath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const isBackground = new Uint8Array(width * height);
for (let p = 0, i = 0; p < width * height; p += 1, i += channels) {
  const brightest = Math.max(data[i], data[i + 1], data[i + 2]);
  if (brightest <= BACKGROUND_MAX) isBackground[p] = 1;
}

/** True when any pixel within EDGE_RADIUS of (x, y) is canvas. */
function touchesBackground(x, y) {
  for (let dy = -EDGE_RADIUS; dy <= EDGE_RADIUS; dy += 1) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -EDGE_RADIUS; dx <= EDGE_RADIUS; dx += 1) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      if (isBackground[yy * width + xx]) return true;
    }
  }
  return false;
}

const rgba = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const p = y * width + x;
    const i = p * channels;
    const o = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (isBackground[p]) {
      rgba[o + 3] = 0;
      continue;
    }

    const brightest = Math.max(r, g, b);
    if (brightest >= EDGE_FULL || !touchesBackground(x, y)) {
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      continue;
    }

    // An anti-aliased pixel: its colour is the sign's colour multiplied down towards
    // black by its coverage. Recover the coverage as alpha and divide it back out, so
    // the edge composites the same way over any background it lands on.
    const alpha = Math.min(1, Math.max(0, (brightest - BACKGROUND_MAX) / (EDGE_FULL - BACKGROUND_MAX)));
    rgba[o] = Math.min(255, Math.round(r / alpha));
    rgba[o + 1] = Math.min(255, Math.round(g / alpha));
    rgba[o + 2] = Math.min(255, Math.round(b / alpha));
    rgba[o + 3] = Math.round(alpha * 255);
  }
}

const keyed = await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toBuffer();

// ---------------------------------------------------------------------------
// 2. The header mark: trimmed, squared with a little breathing room, 512px.
// ---------------------------------------------------------------------------

const trimmed = await sharp(keyed).trim({ threshold: 5 }).png().toBuffer();
const trimmedMeta = await sharp(trimmed).metadata();

const side = Math.max(trimmedMeta.width, trimmedMeta.height);
const pad = Math.round(side * 0.06);
const canvas = side + pad * 2;

const squared = await sharp({
  create: {
    width: canvas,
    height: canvas,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: trimmed,
      left: Math.round((canvas - trimmedMeta.width) / 2),
      top: Math.round((canvas - trimmedMeta.height) / 2),
    },
  ])
  .png()
  .toBuffer();

const MARK_SIZE = 512;
await sharp(squared)
  .resize(MARK_SIZE, MARK_SIZE, { kernel: sharp.kernel.lanczos3 })
  .png()
  .toFile(MARK_OUT);
console.log(`Wrote ${MARK_OUT} (${MARK_SIZE}x${MARK_SIZE})`);

// ---------------------------------------------------------------------------
// 3. The app icon: the same transparent mark, no plate.
// ---------------------------------------------------------------------------
//
// The 6% pad from step 2 is kept as-is. A favicon is drawn at 16–32px, where a mark
// that fills the square reads best; the pad is only there so the ring's anti-aliased
// edge never touches the tile boundary.

const ICON_SIZE = 512;
await sharp(squared)
  .resize(ICON_SIZE, ICON_SIZE, { kernel: sharp.kernel.lanczos3 })
  .png()
  .toFile(ICON_OUT);
console.log(`Wrote ${ICON_OUT} (${ICON_SIZE}x${ICON_SIZE}, transparent)`);
