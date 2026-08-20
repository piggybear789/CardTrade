'use client';

import { m } from 'motion/react';

import { MOTION_TRANSITION } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

/** Shared-layout underline for URL or local tab strips. */
export function TabIndicator({
  layoutId,
  className,
}: {
  layoutId: string;
  className?: string;
}) {
  return (
    <m.span
      layoutId={layoutId}
      className={cn(
        'absolute inset-x-0 -bottom-px h-0.5 rounded-t-full bg-gold',
        className,
      )}
      transition={MOTION_TRANSITION}
      aria-hidden
    />
  );
}
