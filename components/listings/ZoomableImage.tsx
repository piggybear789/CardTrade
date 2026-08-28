'use client';

// components/listings/ZoomableImage.tsx
//
// Click toggles a 2.5× magnifier; moving the pointer then pans (eBay-style).
// Used inside the photo popout so sales, listings, and trades inspect a slab
// the same way. Keyboard users are unaffected.

import { useCallback, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ZoomInIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

/** Strong enough to read a slab label. */
const ZOOM_SCALE = 2.5;

export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [zoomPoint, setZoomPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);
  const draggedRef = useRef(false);

  const resetZoom = useCallback(() => {
    setZoomPoint(null);
    setPanning(false);
  }, []);

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    setZoomPoint((current) =>
      current
        ? null
        : { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    );
    setPanning(false);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!zoomPoint) return;
      if (event.pointerType !== 'mouse' && event.buttons === 0) return;
      if (event.buttons > 0) draggedRef.current = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      setPanning(true);
      setZoomPoint({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    },
    [zoomPoint],
  );

  return (
    <div
      className={cn(
        'group relative h-[min(80dvh,36rem)] w-full overflow-hidden',
        zoomPoint ? 'cursor-zoom-out [touch-action:none]' : 'cursor-zoom-in',
        className,
      )}
      onClick={handleClick}
      onPointerDown={() => {
        draggedRef.current = false;
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetZoom}
      onPointerCancel={resetZoom}
      onWheel={(event) => {
        if (zoomPoint) event.preventDefault();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={cn(
          'h-full w-full object-contain will-change-transform',
          zoomPoint ? 'cursor-zoom-out' : 'cursor-zoom-in',
          panning
            ? 'transition-none'
            : 'transition-transform duration-150 ease-out motion-reduce:transition-none',
        )}
        style={{
          transformOrigin: '0 0',
          ...(zoomPoint
            ? {
                transform: `translate(${-(ZOOM_SCALE - 1) * zoomPoint.x}px, ${
                  -(ZOOM_SCALE - 1) * zoomPoint.y
                }px) scale(${ZOOM_SCALE})`,
              }
            : {}),
        }}
        draggable={false}
      />
      <p
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-3 left-3 flex items-center gap-tight rounded-full border border-white/15 bg-obsidian/65 px-snug py-1 text-meta font-medium text-white/90 shadow-sm backdrop-blur transition-opacity duration-200',
          zoomPoint ? 'opacity-0' : 'opacity-100',
        )}
      >
        <HugeiconsIcon icon={ZoomInIcon} className="size-3.5" />
        <span className="[@media(hover:none)]:hidden">Click to zoom</span>
        <span className="hidden [@media(hover:none)]:inline">Tap to zoom</span>
      </p>
    </div>
  );
}
