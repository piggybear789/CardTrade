'use client';

import { domMax, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { MOTION_TRANSITION } from '@/lib/motion/tokens';

/**
 * Motion context for the surfaces that actually animate.
 *
 * This used to wrap the root layout. `motion/react` re-exports the whole of
 * framer-motion, and a dynamic `import()` of `domMax` from that barrel is still
 * traced into the catalog's synchronous scripts. The catalog never mounts `m`,
 * so the layout engine was first-paint JavaScript for an underline that is not
 * on the page. Components that slide, fade, or share a `layoutId` wrap themselves
 * in this instead.
 *
 * `domMax`, not `domAnimation`. The layout feature — and with it every `layoutId`
 * shared-element animation — ships only in `domMax`.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={MOTION_TRANSITION}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
