import type { ReactNode } from 'react';

/**
 * Page content wrapper, deliberately WITHOUT a page transition.
 *
 * This used to be a `<ViewTransition>` that slid the whole page 60px sideways
 * and cross-faded it on every forward/back navigation (~150ms exit + 240–400ms
 * move). That made the app feel animated rather than fast: SaaS navigation is
 * an instant swap. The listing-cover morph (`listing-image-*`) is the one
 * navigation motion kept, because it carries information — the card you
 * clicked becomes the page.
 *
 * Kept as a component so the call sites in `MarketplaceShell` stay put, and so
 * a transition can be reintroduced in one place if it is ever wanted.
 */
export function DirectionalTransition({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
