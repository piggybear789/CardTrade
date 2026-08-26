'use client';

// Viewport-tier mounts so a single control tree (e.g. catalog filters with
// stable ids) is not duplicated in the rail and the mobile column.

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

const LG_QUERY = '(min-width: 768px)';

function subscribeLg(onChange: () => void) {
  const media = window.matchMedia(LG_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getLgSnapshot() {
  return window.matchMedia(LG_QUERY).matches;
}

/** SSR assumes mobile so the first paint matches the thumb-first shell. */
function getLgServerSnapshot() {
  return false;
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribeLg, getLgSnapshot, getLgServerSnapshot);
}

/** Renders children only below the desktop chrome split (`md` = 768px). */
export function MobileOnly({ children }: { children: ReactNode }) {
  return useIsDesktop() ? null : children;
}

/** Renders children only at the desktop chrome split and up (`md` = 768px). */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return useIsDesktop() ? children : null;
}
