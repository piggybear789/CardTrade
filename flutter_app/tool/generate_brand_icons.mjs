// Generates the NoDitto brand rasters: the source artwork under `assets/brand/`, the
// launcher icon, the launch splash, and every Android resource that references them.
//
// Satisfies Req 5.1-5.5 of .kiro/specs/mobile-release-readiness. Per decision D11 the
// mark is a PROVISIONAL monogram, not final artwork - see assets/brand/README.md.
//
// The splash lives here rather than in a sibling tool because it is the SAME mark
// rasterised in a different colour on a different canvas, and a second tool would mean
// a second copy of the PNG encoder and the monogram geometry below.
//
// This is a REGENERATION tool, never a build step: everything it writes is checked in.
// It is plain Node with no dependencies (zlib is built in) because the design's
// suggested route, `flutter_launcher_icons`, cannot resolve against the pinned pub
// cache offline.
//
// Colours are READ FROM `lib/core/theme/tokens.g.dart` rather than typed here, so a
// token change cannot leave the icon behind silently. Req 5.7 forbids changing a
// token, and this tool does not: it only reads.
//
// Usage (from flutter_app/):  node tool/generate_brand_icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Reads one `static const Color <name> = Color(0xAARRGGBB);` out of tokens.g.dart. */
function readToken(source, name) {
  const match = new RegExp(
    `static const Color ${name} = Color\\(0x([0-9A-Fa-f]{8})\\);`,
  ).exec(source);
  if (!match) throw new Error(`token AppColors.${name} not found in tokens.g.dart`);
  const value = parseInt(match[1], 16);
  return {
    a: (value >>> 24) & 0xff,
    r: (value >>> 16) & 0xff,
    g: (value >>> 8) & 0xff,
    b: value & 0xff,
    hex: `#${match[1].toUpperCase()}`,
  };
}

const tokens = readFileSync(join(root, 'lib/core/theme/tokens.g.dart'), 'utf8');
const brandViolet = readToken(tokens, 'primary'); // AppColors.primary
const brandInk = readToken(tokens, 'primaryForeground'); // AppColors.primaryForeground
// The colour the app's FIRST FRAME paints: `AppTheme.lightTheme.scaffoldBackgroundColor`
// is `AppColors.background`, and `main.dart` passes no `darkTheme` and no `themeMode`,
// so this is what a member sees in a dark system theme too. The splash matches it in
// both resource configurations for exactly that reason (Req 5.5).
const appBackground = readToken(tokens, 'background'); // AppColors.background

// ---------------------------------------------------------------------------
// Geometry, in Android adaptive-icon dp: a 108dp canvas whose inner 66dp is the
// only region no launcher mask can clip. The monogram is bounded to a 60dp box
// centred in that canvas, which sits inside the 66dp safe zone with room spare.
// ---------------------------------------------------------------------------

const CANVAS_DP = 108;
const SAFE_DP = 66;
const MARK_DP = 60;
const MARK_ORIGIN = (CANVAS_DP - MARK_DP) / 2; // 24dp

if (MARK_DP > SAFE_DP) throw new Error('mark escapes the adaptive-icon safe zone');

/**
 * True when a point lies on the "N" monogram. Coordinates are dp within the
 * MARK_DP box: three strokes, two uprights and a diagonal joining them.
 */
function insideMonogram(x, y) {
  const stroke = MARK_DP * 0.2167; // 13dp
  if (x < 0 || y < 0 || x > MARK_DP || y > MARK_DP) return false;
  if (x <= stroke) return true; // left upright
  if (x >= MARK_DP - stroke) return true; // right upright
  const half = stroke / 2;
  const centre = half + (MARK_DP - stroke) * (y / MARK_DP);
  return Math.abs(x - centre) <= half * 1.31; // diagonal, thickness measured horizontally
}

/** True inside a rounded rectangle, all arguments in dp on the CANVAS_DP canvas. */
function insideRoundedRect(x, y, inset, radius) {
  const min = inset;
  const max = CANVAS_DP - inset;
  if (x < min || y < min || x > max || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// ---------------------------------------------------------------------------
// PNG encoding (RGBA8, no dependencies)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** @param pixels RGBA bytes, size*size*4. */
function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Rasterises one layer at `size` px with 4x4 supersampling.
 * `sample(xdp, ydp)` returns `{r,g,b,a}` or null for transparent.
 */
function raster(size, sample) {
  const pixels = Buffer.alloc(size * size * 4);
  const dpPerPx = CANVAS_DP / size;
  const steps = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const xdp = (px + (sx + 0.5) / steps) * dpPerPx;
          const ydp = (py + (sy + 0.5) / steps) * dpPerPx;
          const hit = sample(xdp, ydp);
          if (hit) {
            r += hit.r * hit.a;
            g += hit.g * hit.a;
            b += hit.b * hit.a;
            a += hit.a;
          }
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
        pixels[offset + 3] = Math.round(a / (steps * steps));
      }
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const monogram = (colour) => (xdp, ydp) =>
  insideMonogram(xdp - MARK_ORIGIN, ydp - MARK_ORIGIN) ? colour : null;

/** Adaptive foreground: the mark in the on-primary token, transparent elsewhere. */
const foregroundLayer = monogram({ ...brandInk, a: 255 });

/**
 * Themed-icon monochrome layer (Req 5.3). Android discards the colour and keeps the
 * alpha, so the silhouette is what matters; it is drawn opaque black.
 */
const monochromeLayer = monogram({ r: 0, g: 0, b: 0, a: 255 });

/**
 * Legacy raster for API < 26 (Req 5.4): the same mark composited on a rounded
 * violet square, since pre-26 launchers apply no mask of their own.
 */
function legacyLayer(xdp, ydp) {
  const inset = CANVAS_DP * 0.055;
  const radius = CANVAS_DP * 0.2;
  if (!insideRoundedRect(xdp, ydp, inset, radius)) return null;
  // The legacy mark may run wider than the adaptive one: nothing masks it.
  const scale = MARK_DP / 68;
  const origin = (CANVAS_DP - 68) / 2;
  return insideMonogram((xdp - origin) * scale, (ydp - origin) * scale)
    ? { ...brandInk, a: 255 }
    : { ...brandViolet, a: 255 };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function write(relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  console.log(`wrote ${relativePath}`);
}

// Density buckets. Legacy launcher icons are 48dp; adaptive layers are the full
// 108dp canvas. Both are expressed at the bucket's dp-per-px ratio.
const BUCKETS = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

// Source artwork, at xxxhdpi resolution so replacement art has a size to match.
write('assets/brand/icon_foreground.png', encodePng(432, raster(432, foregroundLayer)));
write('assets/brand/icon_monochrome.png', encodePng(432, raster(432, monochromeLayer)));
write(
  'assets/brand/icon_background_color.txt',
  `${brandViolet.hex}\n` +
    '\n' +
    '# The adaptive icon background, as a value rather than a raster.\n' +
    '# Source of truth: AppColors.primary in lib/core/theme/tokens.g.dart.\n' +
    '# Regenerate with `node tool/generate_brand_icons.mjs` after a token change.\n',
);

for (const [bucket, ratio] of BUCKETS) {
  const legacy = Math.round(48 * ratio);
  const adaptive = Math.round(CANVAS_DP * ratio);
  write(
    `android/app/src/main/res/mipmap-${bucket}/ic_launcher.png`,
    encodePng(legacy, raster(legacy, legacyLayer)),
  );
  write(
    `android/app/src/main/res/mipmap-${bucket}/ic_launcher_foreground.png`,
    encodePng(adaptive, raster(adaptive, foregroundLayer)),
  );
  write(
    `android/app/src/main/res/mipmap-${bucket}/ic_launcher_monochrome.png`,
    encodePng(adaptive, raster(adaptive, monochromeLayer)),
  );
}

write(
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tool/generate_brand_icons.mjs. Do not hand-edit. -->
<!-- Req 5.2: separate foreground and background. Req 5.3: monochrome layer. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`,
);

write(
  'android/app/src/main/res/values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tool/generate_brand_icons.mjs. Do not hand-edit. -->
<resources>
    <!-- ${brandViolet.hex} is AppColors.primary (lib/core/theme/tokens.g.dart, generated
         from the web app's primary CSS variable). Android resources cannot import a Dart
         token, so the literal is named here to keep any drift visible.

         Do not write that variable in its CSS spelling here: a double hyphen is illegal
         inside an XML comment and AAPT2 fails the whole resource compile on it. -->
    <color name="ic_launcher_background">${brandViolet.hex}</color>
</resources>
`,
);

// ---------------------------------------------------------------------------
// Splash (Req 5.5)
//
// The launch window is a plain window background, drawn by the OS before any Dart
// runs, so it is a colour plus a centred bitmap and cannot be anything cleverer.
//
// The mark is drawn in AppColors.primary rather than the icon's
// AppColors.primaryForeground, because the splash sits on the app's background
// (white) instead of the icon's violet tile - the icon's foreground layer would be
// white on white.
//
// The bitmap is emitted per density bucket at a fixed 144dp so it draws the same
// physical size on every screen; `android:gravity="center"` with no tileMode leaves
// the bitmap at its intrinsic density-scaled size.
// ---------------------------------------------------------------------------

const SPLASH_DP = 144;

const splashLayer = monogram({ ...brandViolet, a: 255 });

for (const [bucket, ratio] of BUCKETS) {
  const size = Math.round(SPLASH_DP * ratio);
  write(
    `android/app/src/main/res/drawable-${bucket}/splash_mark.png`,
    encodePng(size, raster(size, splashLayer)),
  );
}

/**
 * The splash background, named once per resource configuration.
 *
 * `values/` and `values-night/` carry the SAME value deliberately: see the
 * appBackground token note above. The night file exists so that the day a dark
 * theme is added, there is a declared place for its background to differ - and so
 * that the current sameness is a written decision rather than a missing file.
 */
const splashBackgroundResource = (configuration) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tool/generate_brand_icons.mjs. Do not hand-edit. -->
<resources>
    <!-- ${appBackground.hex} is AppColors.background (lib/core/theme/tokens.g.dart),
         which is what AppTheme.lightTheme paints as its scaffold background. Android
         resources cannot import a Dart token, so the literal is named here to keep any
         drift visible.

         ${configuration}

         NOT ?android:colorBackground, which the scaffolded splash used: under a dark
         system theme that attribute resolves to a dark grey, so the launch window went
         dark and then swapped to the app's white first frame. Req 5.5 and manual check
         M3 ask for no such swap. -->
    <color name="splash_background">${appBackground.hex}</color>
</resources>
`;

write(
  'android/app/src/main/res/values/splash_background.xml',
  splashBackgroundResource(
    'Light system theme: the app has one theme, and this is its background.',
  ),
);

write(
  'android/app/src/main/res/values-night/splash_background.xml',
  splashBackgroundResource(
    'Dark system theme: the SAME value, because main.dart passes no darkTheme, so\n         the first frame is this colour under a dark system theme as well. A darker\n         splash here would be a visible swap into the first screen, not a match.',
  ),
);

// One drawable for both configurations, driven by the values-night colour above.
// A `drawable-night/` copy would be a second file to keep in step for no gain.
write(
  'android/app/src/main/res/drawable/launch_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tool/generate_brand_icons.mjs. Do not hand-edit. -->
<!-- Req 5.5: the NoDitto mark on the app's own background, in both system themes.
     The light/dark difference (there is none, deliberately) lives in
     values/splash_background.xml and values-night/splash_background.xml. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background" />
    <item>
        <bitmap
            android:gravity="center"
            android:src="@drawable/splash_mark" />
    </item>
</layer-list>
`,
);
