'use client';

// Viewport-tier mounts so a single control tree (e.g. catalog filters with
// stable ids) is not duplicated in the rail and the mobile column.

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { useWorkspaceChrome } from '@/components/layout/WorkspaceChrome';

const LG_QUERY = '(min-width: 768px)';

function subscribeLg(onChange: () => void) {
  const media = window.matchMedia(LG_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getLgSnapshot() {
  return window.matchMedia(LG_QUERY).matches;
}

// Module-level so the identity is stable across renders, which
// `useSyncExternalStore` requires of its server snapshot.
const serverDesktop = () => true;
const serverMobile = () => false;

export function useIsDesktop() {
  // The last viewport this browser reported, if the workspace layout supplied
  // one. Falls back to the thumb-first shell, which is what every render did
  // before the hint existed.
  const { viewport } = useWorkspaceChrome();
  return useSyncExternalStore(
    subscribeLg,
    getLgSnapshot,
    viewport?.isDesktop ? serverDesktop : serverMobile,
  );
}

/** Renders children only below the desktop chrome split (`md` = 768px). */
export function MobileOnly({ children }: { children: ReactNode }) {
  return useIsDesktop() ? null : children;
}

/** Renders children only at the desktop chrome split and up (`md` = 768px). */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return useIsDesktop() ? children : null;
}
