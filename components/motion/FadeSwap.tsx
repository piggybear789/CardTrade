'use client';

import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';

import { EASE_OUT_QUINT, MOTION_DURATION } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

/**
 * Keyed content replacement. Exiting nodes lose pointer events immediately so
 * stale contract actions cannot be clicked while they fade out.
 */
export function FadeSwap({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4, pointerEvents: 'none' }}
        transition={{ duration: MOTION_DURATION.state, ease: EASE_OUT_QUINT }}
        className={cn(className)}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
}
