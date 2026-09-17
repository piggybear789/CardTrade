// components/messages/threadGeometry.ts
//
// The measurements the conversation route's bands share. Nothing renders here.
//
// WHY A COMPONENT-FREE MODULE. Two reasons, and the second is the one that keeps
// biting. The bands are stacked on one surface, so any disagreement between them shows
// as a step down an edge — a bar 2.6px taller than the pane's bar beside it, a composer
// inset 1rem where the bubbles above it are inset 2rem. Stating each value once is the
// only way that stays true.
//
// And the consumers straddle the server/client boundary: `InboxTwoPane` and
// `app/(workspace)/messages/[id]/loading.tsx` are server-rendered, `ChatThread`,
// `MessageLog` and `MessageComposer` are `'use client'`. A plain module with no
// components in it can be imported from either side without dragging a client reference
// into a server tree — see the same trap documented in
// `components/account/account-tabs-config.ts`.

/**
 * The height BOTH pane bars take, so their bottom borders read as one line.
 *
 * 3.75rem (60px) clears the tallest content either bar holds at `lg` and up — the
 * thread's two-line title/meta block plus `py-2.5` — with a little air. Measured, the
 * thread bar was 58.59px against the inbox pane's 56px, because the pane had derived its
 * height from the thread's 36px avatar when the tallest child is the text beside it. A
 * phone has no seam and no pane beside it; there the 44px back chevron makes the bar
 * taller than this, which is fine because `min-height` is a floor.
 */
export const PANE_BAR_MIN_H = 'min-h-[3.75rem]';

/**
 * The horizontal inset for every band in the thread: the subject bar, the log, the
 * standing note and the composer.
 *
 * 1rem was right while the message column capped itself at 44rem and floated in the
 * middle of the pane — the cap was doing the work of the padding. With the column
 * filling the pane, that 1rem became the only thing between the timeline's marker rail
 * and the pane border, and it read as content pressed against the edge. `section` (2rem)
 * from `md` gives the reading pane the room the rest of the workspace has.
 *
 * The phone keeps 1rem with a safe-area floor: there the screen IS the pane, and 2rem
 * off each side is width a bubble needs.
 */
export const MESSAGE_GUTTER = [
  'px-group md:px-section',
  'max-md:pl-[max(1rem,env(safe-area-inset-left))] max-md:pr-[max(1rem,env(safe-area-inset-right))]',
].join(' ');
