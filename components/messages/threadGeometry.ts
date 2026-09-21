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
 * THIS ONLY WORKS WHILE THE VALUE CLEARS THE TALLER BAR'S CONTENT. It is a `min-height`,
 * so when the thread bar's content outgrows it the floor stops binding on that side
 * while it still binds on the inbox side — and the two borders step apart by the
 * difference. That is not a subtle failure: the conversation starts several pixels below
 * the thread list beside it, down the full height of the pane.
 *
 * It has gone wrong exactly that way once. The value was 3.75rem (60px), chosen against
 * a measured 58.59px thread bar whose meta line was `text-body leading-tight` capped at
 * `min-h-[1.1rem]` — 17.6px. The design-system sweep then rebuilt that line as a flex row
 * to hold a status badge, which meant dropping both the cap and `leading-tight` and
 * adding `mt-0.5`, so it became `text-body` at its own 1.6 line-height. Nothing was wrong
 * with that change; it simply made the bar 6.8px taller than the constant written for its
 * predecessor, and the constant was not re-derived.
 *
 * 4.25rem (68px) against the thread bar's current content, which is the tallest either
 * bar holds at `lg` and up:
 *
 *     text-lead/leading-tight title   16 × 1.25            = 20.0px
 *     mt-0.5                                               =  2.0px
 *     meta row, tallest child a Badge  12 × 1.4 + 4 + 2    = 22.8px
 *     py-2.5                           10 × 2              = 20.0px
 *                                                            ------
 *                                                            64.8px
 *
 * The badge is the floor of that third line, not the `text-body` text beside it (22.4px),
 * because `CashSaleStatusBadge` and the "No contract" badge both render there. 68px leaves
 * ~3px of air, in the same spirit as the original.
 *
 * RE-DERIVE THIS WHENEVER THE TYPE SCALE MOVES. `body` is annotated in
 * `tailwind.config.ts` as under test at 14px, up from 13px, with a warning that
 * hand-computed heights derived from a `text-body` line have to be recomputed. This is
 * one of them.
 *
 * A phone has no seam and no pane beside it; there the back chevron and the same title
 * block make the bar taller than this anyway, which is fine because it is a floor.
 */
export const PANE_BAR_MIN_H = 'min-h-[4.25rem]';

/**
 * The horizontal inset for every band in the thread: the subject bar, the log, the
 * standing note and the composer.
 *
 * THAT ORDER IS LOAD-BEARING AND THE NOTE'S POSITION IN IT IS NOT A STYLE CHOICE.
 * The standing note has to come after the log, because {@link PANE_BAR_MIN_H} makes
 * this pane's bar and the inbox pane's bar share one bottom border, and a band
 * inserted between the bar and the log puts a second rule on one side of that line
 * and pushes the conversation below where the thread list starts. The panes share no
 * bottom edge, so this is the only place a band can be added. It has been moved up
 * once and reverted; see the note at the call site in `ChatThread`.
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
