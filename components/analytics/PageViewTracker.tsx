'use client';

// components/analytics/PageViewTracker.tsx
//
// Records one PAGE_VIEW per route the member lands on (0121). Mounted once, in the root
// layout, and renders nothing.
//
// ── WHY `usePathname` AND NOT A ROUTER EVENT ───────────────────────────────────
//
// The App Router exposes no navigation event. `usePathname` re-renders this component on
// every client-side navigation, which is precisely the signal wanted and costs nothing,
// because the component returns `null` and so has no subtree to re-render.
//
// ── WHY THE GUARD AGAINST REPEATS ─────────────────────────────────────────────
//
// The effect must fire once per ARRIVAL, and `useEffect` does not guarantee that on its
// own. Two things make it fire again on the same path: React's development Strict Mode
// double-invokes effects, and a `router.refresh()` — which several flows here call after a
// successful write — re-renders this component without changing the path. Without the ref
// check, a single listing creation would post two or three page views for the same route
// and every funnel would read high by an amount that varies per flow.
//
// The ref holds the last path RECORDED rather than a boolean, so a genuine A → B → A
// navigation still records the return to A. That is the behaviour wanted: coming back is a
// real event, and on this app it is often the interesting one — a member bouncing between
// the listing form and the verification tab is the exact pattern the first user reported.
//
// ── WHAT IS NOT RECORDED ──────────────────────────────────────────────────────
//
// The query string, because `trackPageView` hands the path to `toRouteTemplate`, which
// drops it. So `?tab=verification` does not distinguish two views of `/profile`. That is a
// real loss of resolution and it is the right trade: the alternative is storing
// `?token=`, `?redirectTo=` and every other query a member's URL happens to carry. If a
// tab genuinely needs its own funnel, give it a route.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { trackPageView } from '@/lib/analytics/track';

export function PageViewTracker() {
  const pathname = usePathname();
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (lastRecorded.current === pathname) return;
    lastRecorded.current = pathname;
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
