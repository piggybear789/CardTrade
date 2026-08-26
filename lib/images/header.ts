// lib/images/header.ts
//
// Read an image's intrinsic size out of its first few kilobytes, without
// decoding it.
//
// WHY NOT JUST USE `sharp`. For bytes we already hold in memory we do — see
// `lib/images/decode.ts`. This parser exists for the case where we do NOT hold
// the bytes: the backfill (`scripts/backfill-image-dims.ts`) walks tens of
// thousands of stored objects, and downloading each one in full to learn two
// integers would move gigabytes to read a few hundred kilobytes of header. With
// this it issues an HTTP Range request for the first {@link HEADER_PROBE_BYTES}
// and parses what comes back. It is also the fallback when `sharp` refuses a
// file it should have accepted, so one odd photo cannot fail an upload.
//
// Covers exactly the four formats the item-images bucket accepts (JPEG, PNG,
// WebP, GIF — see `ALLOWED_IMAGE_TYPES` in `lib/storage/itemImages.ts`).
// Anything else returns null and the caller falls back to a square tile.
//
// Isomorphic and dependency-free: takes a `Uint8Array`, so it runs in Node, in
// a script, and in the browser.

import { sanitizeImageDim, type ImageDim } from '@/lib/images/dimensions';

/**
 * How much of an object to fetch when probing it over the network.
 *
 * PNG, GIF, and WebP put their size in the first 32 bytes. JPEG does not: the
 * SOF segment sits after every APP segment, and APP1 alone can hold a 64 KB
 * EXIF block with an embedded thumbnail. 128 KB clears the realistic worst case
 * (an EXIF thumbnail plus an ICC profile split across APP2 segments) while
 * still being ~1% of a typical phone photo.
 */
export const HEADER_PROBE_BYTES = 128 * 1024;

/**
 * Intrinsic size from an image header, or `null` if the bytes are not one of
 * the four supported formats, are truncated before the size fields, or carry
 * values that fail {@link sanitizeImageDim}.
 */
export function readImageHeaderDimensions(bytes: Uint8Array): ImageDim | null {
  return (
    readPng(bytes) ??
    readGif(bytes) ??
    readWebp(bytes) ??
    readJpeg(bytes) ??
    null
  );
}

/** Big-endian u16. */
function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

/** Little-endian u16. */
function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

/** Big-endian u32. `>>> 0` keeps it unsigned. */
function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  );
}

/** Little-endian u32. */
function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}

/** ASCII compare, used for the handful of magic numbers below. */
function matches(bytes: Uint8Array, at: number, ascii: string): boolean {
  if (at + ascii.length > bytes.length) return false;
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * PNG: 8-byte signature, then the IHDR chunk, whose first two fields are the
 * width and height. IHDR is required by the spec to come first, so the offsets
 * are fixed.
 */
function readPng(bytes: Uint8Array): ImageDim | null {
  if (bytes.length < 24) return null;
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return null;
  }
  if (!matches(bytes, 12, 'IHDR')) return null;
  return sanitizeImageDim({ w: u32be(bytes, 16), h: u32be(bytes, 20) });
}

/** GIF: the logical screen descriptor follows the 6-byte version header. */
function readGif(bytes: Uint8Array): ImageDim | null {
  if (bytes.length < 10) return null;
  if (!matches(bytes, 0, 'GIF87a') && !matches(bytes, 0, 'GIF89a')) return null;
  return sanitizeImageDim({ w: u16le(bytes, 6), h: u16le(bytes, 8) });
}

/**
 * WebP: a RIFF container whose first chunk identifies the coding.
 * - `VP8 ` lossy: 14-bit dimensions after the 3-byte frame tag and sync code.
 * - `VP8L` lossless: 14-bit dimensions packed into a 32-bit little-endian word.
 * - `VP8X` extended (animation / alpha): 24-bit canvas size, minus one.
 */
function readWebp(bytes: Uint8Array): ImageDim | null {
  if (bytes.length < 30) return null;
  if (!matches(bytes, 0, 'RIFF') || !matches(bytes, 8, 'WEBP')) return null;

  if (matches(bytes, 12, 'VP8 ')) {
    // Sync code guards against a truncated or non-keyframe payload.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return sanitizeImageDim({
      w: u16le(bytes, 26) & 0x3fff,
      h: u16le(bytes, 28) & 0x3fff,
    });
  }

  if (matches(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return null;
    const packed = u32le(bytes, 21);
    return sanitizeImageDim({
      w: (packed & 0x3fff) + 1,
      h: ((packed >>> 14) & 0x3fff) + 1,
    });
  }

  if (matches(bytes, 12, 'VP8X')) {
    const w = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const h = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return sanitizeImageDim({ w, h });
  }

  return null;
}

/**
 * JPEG markers that introduce a frame and therefore carry the image size.
 *
 * Deliberately a set rather than a range: 0xC4 (define Huffman table), 0xC8
 * (reserved), and 0xCC (define arithmetic coding) sit inside 0xC0..0xCF but are
 * NOT frame headers, and reading a height out of a Huffman table produces a
 * plausible-looking wrong answer rather than an error.
 */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * JPEG: walk the segment chain to the frame header.
 *
 * Also reads the EXIF orientation, because a phone photo shot in portrait is
 * very often stored landscape with an orientation tag telling the viewer to
 * rotate it. Browsers apply that rotation by default (`image-orientation:
 * from-image`), so `naturalWidth` from the client uploader already reflects it.
 * If we did not swap here, the same photo would be recorded as portrait or
 * landscape depending on which upload path it took, and the catalog would
 * reserve the wrong shape for half of them.
 */
function readJpeg(bytes: Uint8Array): ImageDim | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let orientation = 1;
  let offset = 2;

  while (offset + 3 < bytes.length) {
    // Segments may be preceded by any number of 0xFF fill bytes.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }

    // Standalone markers: no length field, nothing to skip.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Start of scan — entropy-coded data follows and there is no frame header
    // after it. Whatever we have is all we are going to get.
    if (marker === 0xda) return null;

    const length = u16be(bytes, offset + 2);
    // A length below 2 cannot include its own field: the stream is corrupt.
    if (length < 2) return null;
    const payload = offset + 4;

    if (marker === 0xe1) {
      orientation = readExifOrientation(bytes, payload, length - 2) ?? orientation;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      // precision(1) height(2) width(2)
      if (payload + 5 > bytes.length) return null;
      const h = u16be(bytes, payload + 1);
      const w = u16be(bytes, payload + 3);
      // 5..8 are the transposing orientations (rotate 90/270, with or without
      // a mirror); 1..4 keep the axes as stored.
      return sanitizeImageDim(
        orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h },
      );
    }

    offset = payload + (length - 2);
  }

  return null;
}

/**
 * EXIF orientation (TIFF tag 0x0112) out of an APP1 segment, or `null` when the
 * segment is not EXIF, is truncated, or has no orientation entry.
 *
 * Only IFD0 is walked — orientation lives there, and chasing the sub-IFDs would
 * mean implementing a TIFF reader for a tag we already have.
 */
function readExifOrientation(
  bytes: Uint8Array,
  at: number,
  length: number,
): number | null {
  const end = Math.min(at + length, bytes.length);
  // "Exif\0\0"
  if (at + 6 > end || !matches(bytes, at, 'Exif')) return null;

  const tiff = at + 6;
  if (tiff + 8 > end) return null;

  const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const bigEndian = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;

  const u16 = (o: number) => (littleEndian ? u16le(bytes, o) : u16be(bytes, o));
  const u32 = (o: number) => (littleEndian ? u32le(bytes, o) : u32be(bytes, o));

  if (u16(tiff + 2) !== 0x002a) return null;

  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return null;

  const entries = u16(ifd0);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) !== 0x0112) continue;
    // A SHORT value is stored left-aligned in the 4-byte value field.
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }

  return null;
}
