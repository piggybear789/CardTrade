'use client';

import { useEffect } from 'react';

/**
 * Publishes `--keyboard-inset`: how much of the layout viewport the software
 * keyboard (or any visual-viewport occlusion) currently covers.
 *
 * `interactiveWidget: resizes-content` shrinks `dvh` when the OS resizes the
 * layout viewport — then this value is 0 and bottom-docked sheets are already
 * clear. Android Chrome and Samsung often overlay the keyboard instead, so
 * `100dvh` / `bottom: 0` still sit behind the keys. The visualViewport delta
 * is the only signal that works for both.
 */
export function KeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;

    function sync() {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty('--keyboard-inset', '0px');
        return;
      }
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--keyboard-inset', `${Math.round(occluded)}px`);
    }

    sync();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);

  return null;
}
