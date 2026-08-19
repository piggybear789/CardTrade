'use client';

import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import type { ReactNode } from 'react';

import { MOTION_TRANSITION } from '@/lib/motion/tokens';

/**
 * Reduced-motion-aware Motion context. Server Component children stay server-rendered
 * because this provider only wraps, it does not serialize them.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={MOTION_TRANSITION}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
