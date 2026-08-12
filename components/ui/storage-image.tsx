'use client';

// components/ui/storage-image.tsx
//
// A thin wrapper over next/image for Supabase Storage URLs. Routes images through
// Vercel's image optimization pipeline, which caches transformed copies at edge
// PoPs globally — so a photo stored in ap-northeast-1 is served from the nearest
// Vercel edge rather than Tokyo on every request.
//
// Use this for the PRIMARY (sharp, visible) image in a listing tile, gallery, or
// avatar. Decorative blurred fills behind it can stay as plain <img> — they share
// the same source URL and the browser cache already has the bytes once the primary
// loads through the edge.

import Image, { type ImageProps } from 'next/image';

export interface StorageImageProps extends Omit<ImageProps, 'loader'> {
  /**
   * When true, renders a plain `<img>` instead of `next/image`. Use for
   * decorative copies (blurred backgrounds) where the optimization overhead
   * is not needed and the CSS (transform, scale, blur) conflicts with the
   * wrapper elements next/image adds.
   */
  decorative?: boolean;
}

/**
 * An edge-optimized image for Supabase Storage URLs.
 *
 * Behaves identically to `next/image` with all the same props — responsive
 * sizing, format negotiation (WebP/AVIF), lazy loading. The difference is
 * purely operational: Vercel serves the optimized result from its global CDN
 * rather than the user fetching directly from Supabase's Tokyo origin.
 *
 * Accepts a `decorative` prop to fall back to a plain `<img>` for blurred
 * background fills where the next/image wrapper would interfere with CSS
 * transforms.
 */
export function StorageImage({
  decorative,
  className,
  alt,
  ...props
}: StorageImageProps) {
  if (decorative) {
    // For decorative images, render a plain <img> — the browser cache will
    // already have the bytes from the primary StorageImage that loaded the
    // same URL through the edge optimization endpoint.
    const src = typeof props.src === 'string' ? props.src : '';
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        loading="lazy"
        draggable={false}
      />
    );
  }

  return (
    <Image
      className={className}
      alt={alt}
      {...props}
    />
  );
}
