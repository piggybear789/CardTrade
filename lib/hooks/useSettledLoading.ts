'use client';

// lib/hooks/useSettledLoading.ts
//
// HOW LONG A PLACEHOLDER STAYS UP, so a fast load never flickers.
//
// Skeleton bars are invisible for their first 250ms (`.animate-skeleton` in globals.css),
// so a read that comes back inside that window swaps straight to the content and nobody
// sees a placeholder at all. The bad case is a read that lands just AFTER the bars appear:
// they flash for a few frames and are replaced, which reads as flicker. This holds the
// placeholder for a minimum time once it has become visible, so it is either never seen
// or seen long enough to read as loading.
//
//   const showSkeleton = useSettledLoading(loading);
//
// Returns true while `loading` is true, and keeps returning true after it turns false
// only when the placeholder had already been on screen for less than `minimum` ms.

import { useEffect, useRef, useState } from 'react';

/** Must match the reveal delay on `.animate-skeleton` in globals.css. */
const SKELETON_REVEAL_MS = 250;

export function useSettledLoading(
  loading: boolean,
  { minimum = 450 }: { minimum?: number } = {},
): boolean {
  const [holding, setHolding] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      // The bars become visible after the reveal delay; note when.
      const reveal = window.setTimeout(() => {
        shownAt.current = performance.now();
      }, SKELETON_REVEAL_MS);
      return () => window.clearTimeout(reveal);
    }
    const since = shownAt.current;
    shownAt.current = null;
    if (since === null) return; // finished before anything was visible
    const remaining = minimum - (performance.now() - since);
    if (remaining <= 0) return;
    setHolding(true);
    const release = window.setTimeout(() => setHolding(false), remaining);
    return () => window.clearTimeout(release);
  }, [loading, minimum]);

  return loading || holding;
}
