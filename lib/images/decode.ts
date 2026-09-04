import 'server-only';

// lib/images/decode.ts
//
// Server-side intrinsic size for bytes we are holding.
//
// Used on the upload path that runs THROUGH the server (`uploadImages` in
// `lib/storage/itemImages.ts`), where the buffer is already in memory because
// we are about to write it to Storage. The other upload path never reaches
// here: the browser sends those bytes straight to Storage and reports the
// dimensions itself.
//
// `sharp` first, because it is already a dependency (Next uses it for image
// optimisation), it understands every format the bucket accepts, and it is
// definitive where a header parser is a best effort. The header parser in
// `lib/images/header.ts` is the fallback for the two ways sharp can let us
// down: a platform without the native binary installed, and a file it refuses
// that a browser would happily render. Neither should cost a seller their
// upload, so a total failure degrades to `null` — an unknown dimension, which
// the catalog already renders as a square tile.

import { readImageHeaderDimensions } from '@/lib/images/header';
import { sanitizeImageDim, type ImageDim } from '@/lib/images/dimensions';

/**
 * `sharp`'s constructor, resolved once and cached.
 *
 * Imported dynamically rather than at module load so that a missing or
 * mismatched native binary surfaces as "dimensions unknown" instead of a
 * server-start failure — this module is imported by the listing create/update
 * path, which must keep working without it.
 */
type SharpFactory = (input: Buffer) => {
  metadata(): Promise<{
    width?: number;
    height?: number;
    orientation?: number;
  }>;
};

let sharpFactory: SharpFactory | null | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpFactory !== undefined) return sharpFactory;
  try {
    const mod = (await import('sharp')) as unknown as {
      default?: SharpFactory;
    };
    sharpFactory = mod.default ?? (mod as unknown as SharpFactory);
  } catch {
    sharpFactory = null;
  }
  return sharpFactory;
}

/**
 * Intrinsic pixel size of an image, as a viewer would display it, or `null`
 * when neither reader can make sense of the bytes.
 *
 * "As a viewer would display it" is the important part: an EXIF orientation of
 * 5..8 means the stored raster is rotated a quarter turn from the intended
 * presentation, so the axes are swapped here. Browsers apply that rotation by
 * default, which is what the client-side uploader measures, and the two paths
 * have to agree or the same photo would reserve a different shape depending on
 * how it was uploaded.
 */
export async function decodeImageDimensions(
  bytes: Buffer,
): Promise<ImageDim | null> {
  const sharp = await loadSharp();

  if (sharp) {
    try {
      const meta = await sharp(bytes).metadata();
      const transposed =
        typeof meta.orientation === 'number' &&
        meta.orientation >= 5 &&
        meta.orientation <= 8;
      const dim = sanitizeImageDim(
        transposed
          ? { w: meta.height, h: meta.width }
          : { w: meta.width, h: meta.height },
      );
      if (dim) return dim;
    } catch {
      // Fall through to the header parser.
    }
  }

  return readImageHeaderDimensions(bytes);
}
