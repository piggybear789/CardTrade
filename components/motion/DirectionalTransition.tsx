import { ViewTransition } from 'react';
import type { ReactNode } from 'react';

const DIRECTIONAL = {
  'nav-forward': 'nav-forward',
  'nav-back': 'nav-back',
  default: 'none',
} as const;

/**
 * Hierarchical page enter/exit. Place on page content, not in a persistent layout.
 * Lateral navigations that omit transition types stay instant (`default: none`).
 */
export function DirectionalTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={DIRECTIONAL}
      exit={DIRECTIONAL}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
