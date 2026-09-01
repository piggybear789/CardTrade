'use client';

import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import type { ReactNode } from 'react';

import { MOTION_TRANSITION } from '@/lib/motion/tokens';

/**
 * Reduced-motion-aware Motion context. Server Component children stay server-rendered
 * because this provider only wraps, it does not serialize them.
 *
 * `domMax`, NOT `domAnimation`. The layout feature — and with it every `layoutId`
 * shared-element animation — ships only in `domMax`; `domAnimation` carries the
 * renderer, animations and gestures alone. Under it `TabIndicator` mounted, measured
 * nothing and cut straight to its new position on all three strips that use it, so the
 * underline never actually slid. That silent no-op is what pushed the account chip to
 * reach for a view transition to get a morph `layoutId` was already meant to give it.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={MOTION_TRANSITION}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
