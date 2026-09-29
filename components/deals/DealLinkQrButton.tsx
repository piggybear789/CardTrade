'use client';

// components/deals/DealLinkQrButton.tsx
//
// A QR code for the deal link, for a meetup, where the other person is standing
// next to you and typing a URL is the worst way to share one.
//
// The encoder is imported when the dialog opens rather than with the page: most
// hosts copy or share the link and never scan it. The SVG is drawn from the module
// matrix here, black on white whatever the theme, because a scanner needs that
// contrast more than the dialog needs to match the palette.

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { QrCodeIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function DealLinkQrButton({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [matrix, setMatrix] = useState<boolean[][] | null>(null);

  useEffect(() => {
    if (!open || matrix) return;
    let cancelled = false;
    void import('uqr').then(({ encode }) => {
      if (cancelled) return;
      setMatrix(encode(`${window.location.origin}${path}`, { ecc: 'M', border: 2 }).data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, matrix, path]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <HugeiconsIcon icon={QrCodeIcon} aria-hidden />
          QR code
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan to join</DialogTitle>
          <DialogDescription>
            Have them scan this with their phone camera. It opens the same link.
          </DialogDescription>
        </DialogHeader>
        <div className="mx-auto w-full max-w-64">
          {matrix ? (
            <svg
              viewBox={`0 0 ${matrix.length} ${matrix.length}`}
              role="img"
              aria-label="QR code for the deal link"
              shapeRendering="crispEdges"
              className="aspect-square w-full rounded-md"
            >
              <rect width={matrix.length} height={matrix.length} fill="#ffffff" />
              <path d={modulePath(matrix)} fill="#000000" />
            </svg>
          ) : (
            <div role="status" className="aspect-square w-full animate-pulse rounded-md bg-muted">
              <span className="sr-only">Drawing the QR code</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
