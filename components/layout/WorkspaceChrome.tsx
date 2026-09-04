'use client';

// components/layout/WorkspaceChrome.tsx
//
// Request-scoped chrome facts for the marketplace workspace, read once by
// `app/(workspace)/layout.tsx` and shared with every client component under it.
//
// WHY A CONTEXT AND NOT A PROP. The rail nav is drawn twice: by the real shell,
// and by `MarketplaceShellSkeleton` while a route's data is in flight. Threading
// `staff` down as a prop meant the skeleton could not render the live nav — it
// had no way to get the booleans without a profile read of its own, and a
// placeholder that queries the database is no longer a placeholder. So it drew
// grey bars instead, and every navigation tore the rail down and rebuilt it.
// Reading from a provider mounted in the LAYOUT means the skeleton renders the
// same nav the shell does, and the rail stops flashing.
//
// BOOLEANS, NOT RESOLVED LINKS. A nav link carries `icon`, which is the glyph's
// full path data; serialising the resolved array would inline every icon's
// geometry into the RSC payload of every workspace page. Two booleans cross the
// boundary and the icons resolve from the client bundle.
//
// Navigation only. A capability decided in the browser is a suggestion, not a
// gate — every staff surface re-checks `requireStaff` server-side.

import { createContext, use, useEffect, type ReactNode } from 'react';

/**
 * What the server should assume about the viewport before hydration.
 *
 * `useSyncExternalStore` needs a server snapshot, and a media query has no
 * answer on the server — so both viewport hooks returned `false`, i.e. "phone".
 * On a desktop contract room that produced three layouts in a row: the skeleton
 * drew the CSS `lg:` split, the server HTML drew the phone thread, and hydration
 * swapped back to the split. Nothing about that motion carried information.
 *
 * The last known viewport is written to a cookie by {@link ViewportHintWriter}
 * and read back here, so a returning visitor's first paint is already the right
 * shape. A stale or absent hint is not a correctness problem: the store
 * re-reads the live media query immediately after hydration, which is exactly
 * the behaviour that existed before.
 */
export interface ViewportHint {
  /** `md` and up (768px) — the app-wide chrome split. */
  isDesktop: boolean;
  /** `lg` and up (1024px) — wide enough for the contract room's two panes. */
  isSplit: boolean;
}

export interface WorkspaceChromeValue {
  /** The viewer's staff capability, or `undefined` when signed out. */
  staff?: { isStaff: boolean; isAdmin: boolean };
  /** Last known viewport, for a first paint that matches the screen. */
  viewport?: ViewportHint;
}

/**
 * Defaults to no capability so components rendered outside the workspace group
 * (or in isolation, e.g. a test) degrade to the member nav rather than throwing.
 */
const WorkspaceChromeContext = createContext<WorkspaceChromeValue>({});

export function WorkspaceChromeProvider({
  staff,
  viewport,
  children,
}: WorkspaceChromeValue & { children: ReactNode }) {
  return (
    <WorkspaceChromeContext value={{ staff, viewport }}>
      {children}
      <ViewportHintWriter />
    </WorkspaceChromeContext>
  );
}

export function useWorkspaceChrome(): WorkspaceChromeValue {
  return use(WorkspaceChromeContext);
}

/** Name of the cookie carrying {@link ViewportHint}. Read by the workspace layout. */
export const VIEWPORT_HINT_COOKIE = 'nd_vw';

/**
 * Records the current viewport tier so the NEXT server render starts in the
 * right shape. Renders nothing and holds no React state, so a resize costs a
 * cookie write and no re-render.
 */
function ViewportHintWriter() {
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const split = window.matchMedia('(min-width: 1024px)');

    const write = () => {
      const value = `${desktop.matches ? 'd' : ''}${split.matches ? 's' : ''}` || 'm';
      // Session-scoped and same-site: a layout hint, not something to persist
      // across visits or hand to another origin.
      document.cookie = `${VIEWPORT_HINT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    };

    write();
    desktop.addEventListener('change', write);
    split.addEventListener('change', write);
    return () => {
      desktop.removeEventListener('change', write);
      split.removeEventListener('change', write);
    };
  }, []);

  return null;
}
