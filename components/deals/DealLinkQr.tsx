'use client';

// components/deals/DealLinkQr.tsx
//
// The deal link as a QR code, printed on the ticket's stub so a meetup needs no
// extra tap: the other person scans it straight off the screen.
//
// THE PRINTED CODE IS SMALL ON PURPOSE, AND TAPPING IT OPENS A LARGE ONE. At 96px it
// scans from a phone held close, which covers a host showing their own screen; a code
// held up across a table is the one a camera misses, so tapping it opens the dialog
// version — a bottom sheet on a phone, a centred dialog from `md` — as large as the
// sheet allows.
//
// The encoder is imported after mount rather than with the page, so it stays out of
// the first bundle. The SVG is drawn from the module matrix here, black on white
// whatever the theme, because a scanner needs that contrast more than the code
// needs to match the palette.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function DealLinkQr({ path }: { path: string }) {
  const [matrix, setMatrix] = useState<boolean[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('uqr').then(({ encode }) => {
      if (cancelled) return;
      setMatrix(encode(`${window.location.origin}${path}`, { ecc: 'M', border: 2 }).data);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Show a larger QR code"
          title="Show a larger QR code"
          className="size-24 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border bg-white transition-colors hover:border-foreground/20 focus:outline-none focus-visible:border-iris/60"
        >
          <QrImage matrix={matrix} decorative />
        </button>
      </DialogTrigger>
      <DialogContent className="md:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan to join</DialogTitle>
          <DialogDescription>Opens the same link on their phone.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto w-full max-w-72">
          <QrImage matrix={matrix} className="rounded-md" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" size="lg" className="w-full">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The code itself, or a placeholder of the same square while the encoder loads.
 *
 * `decorative` for the printed copy: its button already says what it is, so the
 * image — or its loading state — announcing itself as well would read the same
 * thing twice.
 */
function QrImage({
  matrix,
  decorative = false,
  className,
}: {
  matrix: boolean[][] | null;
  decorative?: boolean;
  className?: string;
}) {
  if (!matrix) {
    const placeholder = cn('aspect-square w-full animate-pulse bg-muted', className);
    if (decorative) return <div aria-hidden="true" className={placeholder} />;
    return (
      <div role="status" className={placeholder}>
        <span className="sr-only">Drawing the QR code</span>
      </div>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${matrix.length} ${matrix.length}`}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'QR code for the deal link'}
      aria-hidden={decorative ? true : undefined}
      shapeRendering="crispEdges"
      className={cn('aspect-square w-full', className)}
    >
      <rect width={matrix.length} height={matrix.length} fill="#ffffff" />
      <path d={modulePath(matrix)} fill="#000000" />
    </svg>
  );
}

/** One square per dark module, as a single path so the browser draws one shape. */
function modulePath(matrix: boolean[][]): string {
  let d = '';
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return d;
}
