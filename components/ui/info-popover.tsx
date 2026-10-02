'use client';

// components/ui/info-popover.tsx
//
// An (i) beside a label or figure that opens a short note: the explanation behind
// a number, so its row stays one line and the note is there for whoever wants it.
//
// A POPOVER, NOT A TOOLTIP. A tooltip opens on hover and focus only, so on a phone,
// where most members are, it would never open. A popover opens on tap and on
// Enter/Space.

import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function InfoPopover({
  label,
  children,
}: {
  /** The trigger's accessible name, e.g. "About the hold". */
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label}
        // 24px target with the 16px icon centred, clear of WCAG 2.5.8's minimum.
        className="inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={InformationCircleIcon} className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-pretty text-body">
        {children}
      </PopoverContent>
    </Popover>
  );
}
