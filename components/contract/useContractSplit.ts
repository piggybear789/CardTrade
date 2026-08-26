'use client';

// components/contract/useContractSplit.ts
//
// Whether the contract room shows its two-pane split (details beside chat) or
// its thread (chat filling the room, details in a sheet).
//
// This is 1024px, NOT the app-wide 768px in `Breakpoint`. The split needs a
// 24rem minimum for the chat column on top of the workspace rail, which does
// not fit until `lg`; between 768 and 1023 the room used to mount the desktop
// branch without its `lg:` grid, so both panes stacked while each still asked
// for `h-full` of one bounded box and the second was pushed out of view.
//
// Every part of the room that forks on layout reads this one hook, so the row,
// the chat bar's details affordance, and the detail list's chrome can never
// disagree about which shape they are in.

import { useSyncExternalStore } from 'react';

const SPLIT_QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(SPLIT_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(SPLIT_QUERY).matches;
}

/** SSR assumes the thread, matching the thumb-first first paint. */
function getServerSnapshot() {
  return false;
}

/** True once the room is wide enough for details and chat side by side. */
export function useContractSplit() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
