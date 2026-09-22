'use client';

// components/analytics/GateBlockedTracker.tsx
//
// Records a GATE_BLOCKED when a Server Component renders a refusal instead of the thing
// the member asked for (0121). Renders nothing.
//
// ── WHY A CLIENT COMPONENT FOR A SERVER-SIDE DECISION ─────────────────────────
//
// The gate is evaluated on the server — `readIdentityGate` in a page, before any form
// renders — so the obvious thing would be to call `recordUxEvent` there and skip the
// client entirely. That does not work, and the reason is worth stating so nobody
// "simplifies" it back:
//
// The session handle lives in `sessionStorage` (see `lib/analytics/session.ts`), which a
// Server Component cannot read. A server-side write would therefore have no `session_id`,
// and a GATE_BLOCKED with no session cannot be joined to the PAGE_VIEW before it or the
// ACTION_FAILURE after it. The whole value of the row is its position in a journey — "they
// were refused, then went to the verification tab, then came back and were refused again" —
// so a sessionless row records the least interesting part of the event.
//
// Mounting a tiny client component inside the refusal keeps the decision on the server and
// the recording where the session is.
//
// ── ONE ROW PER MOUNT, NOT PER RENDER ─────────────────────────────────────────
//
// Same reasoning as `PageViewTracker`, with one difference: the guard is a plain boolean
// ref rather than a last-value ref, because a refusal does not "change" the way a path
// does. A member who navigates away and comes back mounts this afresh and is counted
// again, which is correct — being refused twice is two events, and the repeat is the
// signal.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { trackGateBlocked } from '@/lib/analytics/track';

export interface GateBlockedTrackerProps {
  /**
   * A slug from `UX_NAMES` naming WHICH gate refused — not why, and not the message shown.
   * Two gates on one route must use two names or the console cannot tell them apart, which
   * is the precise failure the create-listing path had: one refusal on render and a
   * different one on submit, indistinguishable in aggregate.
   */
  gate: string;
}

export function GateBlockedTracker({ gate }: GateBlockedTrackerProps) {
  const pathname = usePathname();
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    if (!pathname) return;
    recorded.current = true;
    trackGateBlocked(gate, pathname);
  }, [gate, pathname]);

  return null;
}
