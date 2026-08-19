'use client';

import { AnimatePresence, m } from 'motion/react';

import { EASE_OUT_QUINT, MOTION_DURATION } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

/** Height/opacity reveal for inline validation copy. */
export function FieldError({
  id,
  message,
  className,
}: {
  id?: string;
  message?: string;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <m.p
          id={id}
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: MOTION_DURATION.feedback, ease: EASE_OUT_QUINT }}
          className={cn('overflow-hidden text-body text-destructive', className)}
        >
          {message}
        </m.p>
      ) : null}
    </AnimatePresence>
  );
}
